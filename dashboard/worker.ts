/**
 * Dashboard 多设备并行 worker：每个子进程绑定一台设备，通过 IPC 回传进度事件。
 * 用法: tsx dashboard/worker.ts '<json-payload>'
 */
import 'dotenv/config';
import { join } from 'node:path';
import { buildTestSummary } from '../core/test-context.js';
import { progressEmitter, type ProgressEvent } from '../core/progress-emitter.js';
import { runAsidePackage } from '../core/aside-runner.js';
import { runBusinessFlow } from '../core/business-runner.js';
import { runPageTest } from '../core/state-machine.js';
import { runL3Explore } from '../core/l5/explore.js';
import { createAgentSession, connectSession } from '../core/ai-agent.js';
import { launchAndroidApp } from '../core/app-launch.js';
import {
  loadPackageProfile,
  resolvePackageDataFile,
} from '../core/package-profile.js';
import { sleep } from '../core/utils.js';
import { loadL5Config } from '../core/l5/config.js';
import type { AgentSession } from '../core/types.js';

interface WorkerPayload {
  kind: 'page' | 'flow' | 'aside' | 'explore';
  id: string;
  runId: string;
  deviceId: string;
  deviceLabel?: string;
  skipLaunch?: boolean;
  runHandoff?: boolean;
  /** 全流程冷启包名；同时写入 ANDROID_PACKAGE，优先于 environment.yaml */
  androidPackage?: string;
  mobile?: string;
  otp?: string;
  accountProfile?: string;
}

const raw = process.argv[2];
if (!raw) {
  console.error('worker: missing JSON payload');
  process.exit(2);
}

const payload = JSON.parse(raw) as WorkerPayload;
process.env.MIDSCENE_DEVICE_UDID = payload.deviceId;

function send(event: ProgressEvent): void {
  const tagged = {
    ...event,
    deviceId: (event as { deviceId?: string }).deviceId ?? payload.deviceId,
    deviceLabel: (event as { deviceLabel?: string }).deviceLabel ?? payload.deviceLabel,
  } as ProgressEvent;
  if (typeof process.send === 'function') {
    process.send(tagged);
  }
}

progressEmitter.on('event', (event: ProgressEvent) => {
  send(event);
});

async function main(): Promise<void> {
  let session: AgentSession | undefined;
  try {
    progressEmitter.emitEvent({
      type: 'run:start',
      runId: payload.runId,
      targetLabel: `${payload.id} @ ${payload.deviceLabel || payload.deviceId}`,
      targetKind: payload.kind,
      deviceId: payload.deviceId,
      deviceLabel: payload.deviceLabel,
    });

    if (payload.kind === 'page') {
      ({ session } = await runPageTest(payload.id, {
        runId: payload.runId,
        deviceId: payload.deviceId,
      }));
    } else if (payload.kind === 'flow') {
      const androidPackage = payload.androidPackage?.trim();
      const mobile = payload.mobile?.trim();
      const otp = payload.otp?.trim();
      const accountProfile = payload.accountProfile?.trim();
      if (androidPackage) process.env.ANDROID_PACKAGE = androidPackage;
      if (mobile) process.env.TEST_MOBILE = mobile;
      if (otp) process.env.TEST_OTP = otp;
      if (accountProfile) process.env.ACCOUNT_PROFILE = accountProfile;
      else if (mobile || otp) delete process.env.ACCOUNT_PROFILE;
      ({ session } = await runBusinessFlow(payload.id, {
        runId: payload.runId,
        deviceId: payload.deviceId,
        skipLaunch: payload.skipLaunch,
        androidPackage,
        mobile,
        otp,
        accountProfile,
      }));
    } else if (payload.kind === 'explore') {
      const cfg = loadL5Config();
      const packageId = payload.id === 'l3-explore' ? (cfg.explore?.packageId || 't57') : payload.id;
      const pkg = loadPackageProfile(packageId);
      const first = pkg.pages[0];
      const dataFile = resolvePackageDataFile(pkg.id, first.dataFile, pkg.sourcePackage);
      session = await createAgentSession({
        pageId: first.id,
        dataFile,
        groupName: `L3 explore / ${pkg.name}`,
        runId: payload.runId,
        deviceId: payload.deviceId,
      });
      session.packageProfile = pkg;
      session.allowedActionDomains = pkg.actionDomains;
      await connectSession(session);
      await sleep(session.env.timing.pageReady);
      await launchAndroidApp(session, pkg.androidPackage, {
        skipLaunch: payload.skipLaunch,
        softFailure: true,
      });
      await runL3Explore(session);
    } else {
      ({ session } = await runAsidePackage(payload.id, {
        runId: payload.runId,
        deviceId: payload.deviceId,
        skipLaunch: payload.skipLaunch,
        runHandoff: payload.runHandoff,
      }));
    }

    const summary = buildTestSummary();
    const pageId = session.meta.id;
    const reportPath = join(
      'midscene_run/output',
      `${pageId}-${payload.runId}-report.html`,
    );
    progressEmitter.emitEvent({
      type: 'run:end',
      runId: payload.runId,
      success: summary.failed === 0,
      summary,
      reportPath,
      midsceneReportPath: session.reportFilePath ?? undefined,
      deviceId: payload.deviceId,
      deviceLabel: payload.deviceLabel,
    });
    process.exitCode = summary.failed === 0 ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progressEmitter.emitEvent({
      type: 'run:end',
      runId: payload.runId,
      success: false,
      error: message,
      deviceId: payload.deviceId,
      deviceLabel: payload.deviceLabel,
    });
    progressEmitter.emitEvent({
      type: 'log',
      runId: payload.runId,
      message: `执行异常: ${message}`,
      deviceId: payload.deviceId,
      deviceLabel: payload.deviceLabel,
    });
    process.exitCode = 1;
  }
}

void main();
