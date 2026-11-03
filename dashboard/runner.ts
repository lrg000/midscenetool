import 'dotenv/config';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { progressEmitter } from '../core/progress-emitter.js';
import { findCatalogItem } from './catalog.js';
import { findAgentPreset, resolveAgentRunEnv, type AgentRunOverride } from './agents.js';
import { listDashboardDevices, type DashboardDevice } from './devices.js';
import type { ProgressEvent } from '../core/progress-emitter.js';

/** 单条并行任务：用例 × 设备 */
export interface RunJob {
  kind: 'page' | 'flow' | 'aside' | 'explore';
  id: string;
  deviceId: string;
  skipLaunch?: boolean;
  runHandoff?: boolean;
  /** 可选展示名；缺省从 catalog 取 */
  title?: string;
  /** 全流程冷启的 Android applicationId；控制台自定义，覆盖环境默认 */
  androidPackage?: string;
  /** 全流程登录手机号 */
  mobile?: string;
  /** 全流程登录 OTP */
  otp?: string;
  /** accounts.yaml 预设 id；自定义号码时不传，避免环境里的 ACCOUNT_PROFILE 改写分流 */
  accountProfile?: string;
  /** 视觉 Agent 预设 id：bailian / chatgpt / claude */
  agentId?: string;
  /** 控制台当场填写的网关/模型/密钥，优先于 agents.local.yaml 与 .env */
  agentConfig?: AgentRunOverride;
}

export interface RunRequest {
  /**
   * 推荐：显式任务列表，支持不同用例跑不同设备。
   * 与 legacy 字段二选一；同时传时以 jobs 为准。
   */
  jobs?: RunJob[];
  /** @deprecated 兼容：同一用例 × 多设备 */
  kind?: 'page' | 'flow' | 'aside' | 'explore';
  id?: string;
  skipLaunch?: boolean;
  runHandoff?: boolean;
  deviceIds?: string[];
}

export interface StopRunOptions {
  /** 指定则只停该设备；缺省停止全部 */
  deviceId?: string;
}

interface ResolvedJob {
  kind: 'page' | 'flow' | 'aside' | 'explore';
  id: string;
  title: string;
  deviceId: string;
  deviceLabel: string;
  skipLaunch?: boolean;
  runHandoff?: boolean;
  androidPackage?: string;
  mobile?: string;
  otp?: string;
  accountProfile?: string;
  agentId?: string;
  agentConfig?: AgentRunOverride;
}

let running = false;
let stopAllRequested = false;
const stoppedDeviceIds = new Set<string>();
let currentBatchId: string | null = null;
const activeChildren = new Map<string, ChildProcess>();

export function isRunActive(): boolean {
  return running;
}

export function getActiveBatchId(): string | null {
  return currentBatchId;
}

export function getActiveDeviceIds(): string[] {
  return [...activeChildren.keys()];
}

function normalizeAndroidPackage(value: string | undefined): string | undefined {
  const pkg = value?.trim();
  return pkg || undefined;
}

function normalizeCredential(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function normalizeAgentConfig(value: AgentRunOverride | undefined): AgentRunOverride | undefined {
  if (!value) return undefined;
  const next: AgentRunOverride = {
    baseUrl: value.baseUrl?.trim() || undefined,
    modelName: value.modelName?.trim() || undefined,
    modelFamily: value.modelFamily?.trim() || undefined,
    apiKey: value.apiKey?.trim() || undefined,
  };
  if (!next.baseUrl && !next.modelName && !next.modelFamily && !next.apiKey) return undefined;
  return next;
}

function workerEnv(job: ResolvedJob): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MIDSCENE_DEVICE_UDID: job.deviceId,
    ...resolveAgentRunEnv(job.agentId, job.agentConfig),
  };
  if (job.androidPackage) env.ANDROID_PACKAGE = job.androidPackage;
  if (job.mobile) env.TEST_MOBILE = job.mobile;
  if (job.otp) env.TEST_OTP = job.otp;
  if (job.accountProfile) env.ACCOUNT_PROFILE = job.accountProfile;
  else if (job.mobile || job.otp) delete env.ACCOUNT_PROFILE;
  return env;
}

function sanitizeDeviceTag(udid: string): string {
  return udid.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isDeviceStopRequested(deviceId: string): boolean {
  return stopAllRequested || stoppedDeviceIds.has(deviceId);
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode == null && !child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, 1500).unref?.();
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

export function stopDashboardRun(
  options: StopRunOptions = {},
): { stopped: boolean; runId: string | null; deviceId?: string; message: string } {
  if (!running) {
    return { stopped: false, runId: null, message: '当前没有执行中的任务' };
  }

  const runId = currentBatchId;
  const deviceId = options.deviceId?.trim();

  if (deviceId) {
    if (!activeChildren.has(deviceId) && !stoppedDeviceIds.has(deviceId)) {
      const stillTracked = progressEmitter
        .getState()
        .devices.some((d) => d.deviceId === deviceId && d.status === 'running');
      if (!stillTracked && !activeChildren.has(deviceId)) {
        return {
          stopped: false,
          runId,
          deviceId,
          message: `设备 ${deviceId} 当前不在执行中`,
        };
      }
    }
    stoppedDeviceIds.add(deviceId);
    const child = activeChildren.get(deviceId);
    progressEmitter.emitEvent({
      type: 'log',
      runId: runId ?? 'stop',
      message: `停止单设备: ${deviceId}`,
      deviceId,
    });
    if (child) {
      killProcessTree(child);
    } else {
      progressEmitter.emitEvent({
        type: 'run:end',
        runId: `${runId}__${sanitizeDeviceTag(deviceId)}`,
        success: false,
        stopped: true,
        error: '用户已停止',
        deviceId,
      });
    }
    return {
      stopped: true,
      runId,
      deviceId,
      message: `已停止设备 ${deviceId}`,
    };
  }

  stopAllRequested = true;
  for (const id of activeChildren.keys()) {
    stoppedDeviceIds.add(id);
  }
  const children = [...activeChildren.values()];
  progressEmitter.emitEvent({
    type: 'log',
    runId: runId ?? 'stop',
    message: `收到全部停止请求，正在终止 ${children.length} 个 worker…`,
  });
  for (const child of children) {
    killProcessTree(child);
  }
  return {
    stopped: true,
    runId,
    message: children.length
      ? `已发送全部停止信号（${children.length} 个进程）`
      : '已标记全部停止',
  };
}

async function resolveJobs(req: RunRequest): Promise<ResolvedJob[]> {
  const connected = await listDashboardDevices();
  const usable = connected.filter((d) => d.usable);
  if (!usable.length) {
    throw new Error('未检测到可用 Android 设备（adb devices 无 device 状态）');
  }

  const deviceMap = new Map<string, DashboardDevice>(connected.map((d) => [d.udid, d]));
  const jobs: ResolvedJob[] = [];

  if (req.jobs?.length) {
    const seenDevices = new Set<string>();
    for (const job of req.jobs) {
      if (!job.kind || !job.id || !job.deviceId) {
        throw new Error('jobs 中每项需要 kind、id、deviceId');
      }
      if (seenDevices.has(job.deviceId)) {
        throw new Error(`同一批次内设备不能重复分配: ${job.deviceId}`);
      }
      seenDevices.add(job.deviceId);
      const device = deviceMap.get(job.deviceId);
      if (!device) throw new Error(`设备未连接: ${job.deviceId}`);
      if (!device.usable) throw new Error(`设备不可用（${device.state}）: ${job.deviceId}`);
      const item = findCatalogItem(job.kind, job.id);
      if (!item) throw new Error(`未找到测试项: ${job.kind}/${job.id}`);
      const agentId = findAgentPreset(job.agentId).id;
      const agentConfig = normalizeAgentConfig(job.agentConfig);
      resolveAgentRunEnv(agentId, agentConfig);
      jobs.push({
        kind: job.kind,
        id: job.id,
        title: job.title?.trim() || item.title,
        deviceId: device.udid,
        deviceLabel: device.label,
        skipLaunch: job.skipLaunch,
        runHandoff: job.runHandoff,
        androidPackage: normalizeAndroidPackage(job.androidPackage),
        mobile: normalizeCredential(job.mobile),
        otp: normalizeCredential(job.otp),
        accountProfile: normalizeCredential(job.accountProfile),
        agentId,
        agentConfig,
      });
    }
    return jobs;
  }

  // legacy: 同一用例 × 多设备
  if (!req.kind || !req.id) {
    throw new Error('请提供 jobs 任务列表，或 legacy 的 kind/id');
  }
  const item = findCatalogItem(req.kind, req.id);
  if (!item) throw new Error(`未找到测试项: ${req.kind}/${req.id}`);

  const deviceIds = req.deviceIds?.length ? req.deviceIds : [usable[0].udid];
  for (const id of deviceIds) {
    const device = deviceMap.get(id);
    if (!device) throw new Error(`设备未连接: ${id}`);
    if (!device.usable) throw new Error(`设备不可用（${device.state}）: ${id}`);
    jobs.push({
      kind: req.kind,
      id: req.id,
      title: item.title,
      deviceId: device.udid,
      deviceLabel: device.label,
      skipLaunch: req.skipLaunch,
      runHandoff: req.runHandoff,
      agentId: findAgentPreset(undefined).id,
    });
  }
  return jobs;
}

export function startDashboardRun(req: RunRequest): string {
  if (running) {
    throw new Error('已有测试任务在运行，请等待完成后再启动');
  }

  const batchId = new Date().toISOString().replace(/[:.]/g, '-');
  running = true;
  stopAllRequested = false;
  stoppedDeviceIds.clear();
  currentBatchId = batchId;
  activeChildren.clear();
  progressEmitter.reset();

  void (async () => {
    try {
      const jobs = await resolveJobs(req);
      if (!jobs.length) throw new Error('没有可执行的任务');
      if (stopAllRequested) throw new Error('用户已停止');

      const uniqueCases = new Set(jobs.map((j) => `${j.kind}/${j.id}`));
      const targetLabel =
        uniqueCases.size === 1
          ? `${jobs[0].title} (${jobs[0].id}) × ${jobs.length} 台`
          : `混合并行 ${uniqueCases.size} 用例 × ${jobs.length} 设备`;

      progressEmitter.emitEvent({
        type: 'batch:start',
        runId: batchId,
        targetLabel,
        targetKind: uniqueCases.size === 1 ? jobs[0].kind : 'mixed',
        devices: jobs.map((j) => ({
          deviceId: j.deviceId,
          label: j.deviceLabel,
          caseTitle: `${j.title} (${j.id})`,
        })),
      });

      await executeJobs(batchId, jobs, targetLabel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stopped = stopAllRequested || message.includes('用户已停止');
      progressEmitter.emitEvent({
        type: 'run:end',
        runId: batchId,
        success: false,
        stopped,
        error: stopped ? '用户已停止' : message,
      });
      progressEmitter.emitEvent({
        type: 'log',
        runId: batchId,
        message: stopped ? '执行已停止' : `执行异常: ${message}`,
      });
    } finally {
      running = false;
      stopAllRequested = false;
      stoppedDeviceIds.clear();
      currentBatchId = null;
      activeChildren.clear();
    }
  })();

  return batchId;
}

function executeJobs(batchId: string, jobs: ResolvedJob[], batchTitle: string): Promise<void> {
  const workerFile = fileURLToPath(new URL('./worker.ts', import.meta.url));
  const results: Array<{ deviceId: string; caseId: string; success: boolean; stopped?: boolean }> =
    [];

  return Promise.all(
    jobs.map(
      (job) =>
        new Promise<void>((resolve) => {
          if (isDeviceStopRequested(job.deviceId)) {
            results.push({
              deviceId: job.deviceId,
              caseId: job.id,
              success: false,
              stopped: true,
            });
            progressEmitter.emitEvent({
              type: 'run:end',
              runId: `${batchId}__${sanitizeDeviceTag(job.deviceId)}`,
              success: false,
              stopped: true,
              error: '用户已停止',
              deviceId: job.deviceId,
              deviceLabel: job.deviceLabel,
            });
            resolve();
            return;
          }

          const workerRunId = `${batchId}__${sanitizeDeviceTag(job.deviceId)}`;
          progressEmitter.registerWorkerRun(workerRunId);

          const payload = JSON.stringify({
            kind: job.kind,
            id: job.id,
            runId: workerRunId,
            deviceId: job.deviceId,
            deviceLabel: job.deviceLabel,
            skipLaunch: job.skipLaunch,
            runHandoff: job.runHandoff,
            androidPackage: job.androidPackage,
            mobile: job.mobile,
            otp: job.otp,
            accountProfile: job.accountProfile,
            agentId: job.agentId,
            agentConfig: job.agentConfig
              ? {
                  baseUrl: job.agentConfig.baseUrl,
                  modelName: job.agentConfig.modelName,
                  modelFamily: job.agentConfig.modelFamily,
                }
              : undefined,
          });

          progressEmitter.emitEvent({
            type: 'log',
            runId: batchId,
            message: `启动 worker: ${job.title} @ ${job.deviceLabel} (${job.deviceId}) · Agent ${job.agentId || 'bailian'}${job.agentConfig?.modelName ? ` · ${job.agentConfig.modelName}` : ''}`,
            deviceId: job.deviceId,
            deviceLabel: job.deviceLabel,
          });

          const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
          const child = spawn(process.execPath, [tsxCli, workerFile, payload], {
            cwd: process.cwd(),
            env: workerEnv(job),
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            windowsHide: true,
          });
          activeChildren.set(job.deviceId, child);

          child.stdout?.on('data', (buf: Buffer) => {
            const text = buf.toString('utf-8').trim();
            if (!text) return;
            for (const line of text.split(/\r?\n/)) {
              progressEmitter.emitEvent({
                type: 'log',
                runId: batchId,
                message: `[${job.id}@${job.deviceId}] ${line}`,
                deviceId: job.deviceId,
                deviceLabel: job.deviceLabel,
              });
            }
          });

          child.stderr?.on('data', (buf: Buffer) => {
            const text = buf.toString('utf-8').trim();
            if (!text) return;
            progressEmitter.emitEvent({
              type: 'log',
              runId: batchId,
              message: `[${job.id}@${job.deviceId}][err] ${text.slice(0, 500)}`,
              deviceId: job.deviceId,
              deviceLabel: job.deviceLabel,
            });
          });

          child.on('message', (msg: unknown) => {
            const event = msg as ProgressEvent;
            if (event.type === 'run:end' && isDeviceStopRequested(job.deviceId)) {
              const stoppedEvent: ProgressEvent = {
                ...event,
                success: false,
                stopped: true,
                error: '用户已停止',
                deviceId: job.deviceId,
                deviceLabel: job.deviceLabel,
              };
              progressEmitter.emitEvent(stoppedEvent);
              if (!results.some((r) => r.deviceId === job.deviceId)) {
                results.push({
                  deviceId: job.deviceId,
                  caseId: job.id,
                  success: false,
                  stopped: true,
                });
              }
              return;
            }
            progressEmitter.emitEvent(event);
            if (event.type === 'run:end') {
              results.push({
                deviceId: job.deviceId,
                caseId: job.id,
                success: event.success,
                stopped: Boolean(event.stopped),
              });
            }
          });

          const finish = (code: number | null) => {
            activeChildren.delete(job.deviceId);
            const deviceStopped = isDeviceStopRequested(job.deviceId);
            if (!results.some((r) => r.deviceId === job.deviceId)) {
              const ok = code === 0 && !deviceStopped;
              results.push({
                deviceId: job.deviceId,
                caseId: job.id,
                success: ok,
                stopped: deviceStopped || undefined,
              });
              progressEmitter.emitEvent({
                type: 'run:end',
                runId: workerRunId,
                success: ok,
                stopped: deviceStopped,
                error: ok ? undefined : deviceStopped ? '用户已停止' : `worker 退出码 ${code}`,
                deviceId: job.deviceId,
                deviceLabel: job.deviceLabel,
              });
            } else if (deviceStopped) {
              progressEmitter.emitEvent({
                type: 'log',
                runId: batchId,
                message: `${job.title} @ ${job.deviceLabel} 已停止并退出`,
                deviceId: job.deviceId,
                deviceLabel: job.deviceLabel,
              });
            }
            resolve();
          };

          child.on('exit', (code) => finish(code));
          child.on('error', (err) => {
            activeChildren.delete(job.deviceId);
            const deviceStopped = isDeviceStopRequested(job.deviceId);
            if (!results.some((r) => r.deviceId === job.deviceId)) {
              results.push({
                deviceId: job.deviceId,
                caseId: job.id,
                success: false,
                stopped: deviceStopped,
              });
              progressEmitter.emitEvent({
                type: 'run:end',
                runId: workerRunId,
                success: false,
                stopped: deviceStopped,
                error: deviceStopped ? '用户已停止' : err.message,
                deviceId: job.deviceId,
                deviceLabel: job.deviceLabel,
              });
            }
            resolve();
          });
        }),
    ),
  ).then(() => {
    const allOk = results.length > 0 && results.every((r) => r.success);
    const allStopped = results.length > 0 && results.every((r) => r.stopped);
    const anyStopped = results.some((r) => r.stopped);
    const batchStopped = stopAllRequested || allStopped;

    let error: string | undefined;
    if (allOk) {
      error = undefined;
    } else if (batchStopped) {
      error = '用户已停止';
    } else if (anyStopped) {
      const stoppedIds = results.filter((r) => r.stopped).map((r) => `${r.caseId}@${r.deviceId}`);
      const failedIds = results
        .filter((r) => !r.success && !r.stopped)
        .map((r) => `${r.caseId}@${r.deviceId}`);
      error = [
        stoppedIds.length ? `已停止: ${stoppedIds.join(', ')}` : '',
        failedIds.length ? `失败: ${failedIds.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('；');
    } else {
      error = `部分任务失败: ${results
        .filter((r) => !r.success)
        .map((r) => `${r.caseId}@${r.deviceId}`)
        .join(', ')}`;
    }

    progressEmitter.emitEvent({
      type: 'run:end',
      runId: batchId,
      success: allOk,
      stopped: batchStopped,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        skipped: 0,
        passRate: results.length
          ? Math.round((results.filter((r) => r.success).length / results.length) * 1000) / 10
          : 0,
      },
      error,
    });
    progressEmitter.emitEvent({
      type: 'log',
      runId: batchId,
      message: batchStopped
        ? `全部停止: ${batchTitle} · 完成 ${results.filter((r) => r.success).length}/${results.length}`
        : `执行结束: ${batchTitle} · 成功 ${results.filter((r) => r.success).length}/${results.length}`,
    });
  });
}
