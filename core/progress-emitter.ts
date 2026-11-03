import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestSummary } from './types.js';

export type RunStatus = 'idle' | 'running' | 'success' | 'failed' | 'stopped';

export interface DeviceRunState {
  deviceId: string;
  label: string;
  /** 该设备上正在/已跑的用例标题 */
  caseTitle: string;
  status: RunStatus;
  currentStep: string;
  currentExpectation: string;
  phase: string;
  passed: number;
  failed: number;
  skipped: number;
  reportPath: string | null;
  midsceneReportPath: string | null;
  error: string | null;
}

export interface LiveRunState {
  runId: string | null;
  status: RunStatus;
  targetLabel: string;
  targetKind: string;
  startedAt: string | null;
  finishedAt: string | null;
  phase: string;
  pageId: string;
  pageTitle: string;
  pageIndex: number;
  pageTotal: number;
  stepIndex: number;
  stepTotal: number;
  currentStep: string;
  currentExpectation: string;
  currentCase: string;
  passed: number;
  failed: number;
  skipped: number;
  reportPath: string | null;
  midsceneReportPath: string | null;
  error: string | null;
  /** 多设备并行时各设备状态 */
  devices: DeviceRunState[];
  /** 当前焦点设备（最近有事件的设备） */
  focusDeviceId: string | null;
}

type WithDevice = { deviceId?: string; deviceLabel?: string };

export type ProgressEvent =
  | ({ type: 'run:start'; runId: string; targetLabel: string; targetKind: string } & WithDevice)
  | ({
      type: 'run:end';
      runId: string;
      success: boolean;
      stopped?: boolean;
      summary?: TestSummary;
      reportPath?: string;
      midsceneReportPath?: string;
      error?: string;
    } & WithDevice)
  | ({ type: 'phase'; runId: string; phase: string; label: string } & WithDevice)
  | ({
      type: 'page:start';
      runId: string;
      pageId: string;
      title: string;
      pageIndex: number;
      pageTotal: number;
      stepTotal: number;
    } & WithDevice)
  | ({
      type: 'step:start';
      runId: string;
      stepIndex: number;
      stepTotal: number;
      section: string;
      label: string;
      stepType: string;
      expectation?: string;
    } & WithDevice)
  | ({ type: 'step:end'; runId: string; stepIndex: number; success: boolean } & WithDevice)
  | ({
      type: 'case';
      runId: string;
      name: string;
      status: 'passed' | 'failed' | 'skipped';
      error?: string;
      caseIndex: number;
    } & WithDevice)
  | ({ type: 'ai:start'; runId: string; method: string; prompt: string } & WithDevice)
  | ({
      type: 'ai:end';
      runId: string;
      method: string;
      prompt: string;
      durationMs: number;
      success: boolean;
    } & WithDevice)
  | ({ type: 'log'; runId: string; message: string } & WithDevice)
  | ({
      type: 'l5';
      runId: string;
      channel: 'api' | 'sql' | 'rule' | 'ui' | 'diagnose';
      status: 'passed' | 'failed' | 'skipped';
      name: string;
      detail?: string;
      reportPath?: string;
    } & WithDevice)
  | {
      type: 'batch:start';
      runId: string;
      targetLabel: string;
      targetKind: string;
      devices: Array<{ deviceId: string; label: string; caseTitle?: string }>;
    };

const LIVE_DIR = join(process.cwd(), 'midscene_run', 'live');

function defaultDeviceState(deviceId: string, label: string, caseTitle = ''): DeviceRunState {
  return {
    deviceId,
    label,
    caseTitle,
    status: 'idle',
    currentStep: '',
    currentExpectation: '',
    phase: '',
    passed: 0,
    failed: 0,
    skipped: 0,
    reportPath: null,
    midsceneReportPath: null,
    error: null,
  };
}

function defaultState(): LiveRunState {
  return {
    runId: null,
    status: 'idle',
    targetLabel: '',
    targetKind: '',
    startedAt: null,
    finishedAt: null,
    phase: '',
    pageId: '',
    pageTitle: '',
    pageIndex: 0,
    pageTotal: 0,
    stepIndex: 0,
    stepTotal: 0,
    currentStep: '',
    currentExpectation: '',
    currentCase: '',
    passed: 0,
    failed: 0,
    skipped: 0,
    reportPath: null,
    midsceneReportPath: null,
    error: null,
    devices: [],
    focusDeviceId: null,
  };
}

class ProgressEmitter extends EventEmitter {
  private state: LiveRunState = defaultState();
  private caseIndex = 0;
  private activeRunId: string | null = null;
  private workerRunIds = new Set<string>();

  getState(): LiveRunState {
    return {
      ...this.state,
      devices: this.state.devices.map((d) => ({ ...d })),
    };
  }

  emitEvent(event: ProgressEvent): void {
    this.applyEvent(event);
    this.persist();
    this.emit('event', event);
  }

  reset(): void {
    this.state = defaultState();
    this.caseIndex = 0;
    this.activeRunId = null;
    this.workerRunIds.clear();
    this.persist();
  }

  /** 登记并行 worker 的 runId，使其事件归入当前 batch */
  registerWorkerRun(runId: string): void {
    this.workerRunIds.add(runId);
  }

  private isActiveBatchEvent(runId: string): boolean {
    return runId === this.activeRunId || this.workerRunIds.has(runId);
  }

  private ensureDevice(deviceId: string, label?: string, caseTitle?: string): DeviceRunState {
    let slot = this.state.devices.find((d) => d.deviceId === deviceId);
    if (!slot) {
      slot = defaultDeviceState(deviceId, label || deviceId, caseTitle || '');
      this.state.devices.push(slot);
    } else {
      if (label) slot.label = label;
      if (caseTitle) slot.caseTitle = caseTitle;
    }
    return slot;
  }

  private recomputeAggregates(): void {
    if (!this.state.devices.length) return;
    this.state.passed = this.state.devices.reduce((n, d) => n + d.passed, 0);
    this.state.failed = this.state.devices.reduce((n, d) => n + d.failed, 0);
    this.state.skipped = this.state.devices.reduce((n, d) => n + d.skipped, 0);
    const anyRunning = this.state.devices.some((d) => d.status === 'running');
    const allDone = this.state.devices.every(
      (d) => d.status === 'success' || d.status === 'failed' || d.status === 'stopped',
    );
    if (anyRunning) {
      this.state.status = 'running';
    } else if (allDone && this.state.devices.length) {
      if (this.state.devices.some((d) => d.status === 'stopped')) {
        this.state.status = 'stopped';
      } else {
        this.state.status = this.state.devices.every((d) => d.status === 'success') ? 'success' : 'failed';
      }
    }
  }

  private applyEvent(event: ProgressEvent): void {
    switch (event.type) {
      case 'batch:start':
        this.activeRunId = event.runId;
        this.workerRunIds.clear();
        this.caseIndex = 0;
        this.state = {
          ...defaultState(),
          runId: event.runId,
          status: 'running',
          targetLabel: event.targetLabel,
          targetKind: event.targetKind,
          startedAt: new Date().toISOString(),
          devices: event.devices.map((d) =>
            defaultDeviceState(d.deviceId, d.label, d.caseTitle ?? ''),
          ),
          focusDeviceId: event.devices[0]?.deviceId ?? null,
        };
        break;

      case 'run:start': {
        if (event.deviceId) {
          if (!this.isActiveBatchEvent(event.runId) && event.runId !== this.activeRunId) {
            // 单设备兼容：无 batch 时当作新 run
            if (!this.activeRunId || this.state.status !== 'running') {
              this.activeRunId = event.runId;
              this.caseIndex = 0;
              this.state = {
                ...defaultState(),
                runId: event.runId,
                status: 'running',
                targetLabel: event.targetLabel,
                targetKind: event.targetKind,
                startedAt: new Date().toISOString(),
                devices: [defaultDeviceState(event.deviceId, event.deviceLabel || event.deviceId)],
                focusDeviceId: event.deviceId,
              };
            }
          }
          const slot = this.ensureDevice(event.deviceId, event.deviceLabel, event.targetLabel);
          slot.status = 'running';
          slot.error = null;
          if (event.targetLabel) slot.caseTitle = event.targetLabel;
          this.state.focusDeviceId = event.deviceId;
          this.state.status = 'running';
          this.state.targetLabel = event.targetLabel || this.state.targetLabel;
          this.state.targetKind = event.targetKind || this.state.targetKind;
          break;
        }
        this.activeRunId = event.runId;
        this.caseIndex = 0;
        this.state = {
          ...defaultState(),
          runId: event.runId,
          status: 'running',
          targetLabel: event.targetLabel,
          targetKind: event.targetKind,
          startedAt: new Date().toISOString(),
        };
        break;
      }

      case 'run:end': {
        if (event.deviceId) {
          if (!this.isActiveBatchEvent(event.runId) && event.runId !== this.activeRunId) return;
          const slot = this.ensureDevice(event.deviceId, event.deviceLabel);
          slot.status = event.stopped ? 'stopped' : event.success ? 'success' : 'failed';
          slot.reportPath = event.reportPath ?? null;
          slot.midsceneReportPath = event.midsceneReportPath ?? null;
          slot.error = event.error ?? null;
          if (event.summary) {
            slot.passed = event.summary.passed;
            slot.failed = event.summary.failed;
            slot.skipped = event.summary.skipped;
          }
          this.state.focusDeviceId = event.deviceId;
          this.recomputeAggregates();
          if (
            this.state.devices.every(
              (d) => d.status === 'success' || d.status === 'failed' || d.status === 'stopped',
            )
          ) {
            this.state.finishedAt = new Date().toISOString();
            this.state.reportPath = this.state.devices.map((d) => d.reportPath).find(Boolean) ?? null;
            this.state.midsceneReportPath =
              this.state.devices.map((d) => d.midsceneReportPath).find(Boolean) ?? null;
            this.state.error = this.state.devices.map((d) => d.error).find(Boolean) ?? null;
          }
          break;
        }
        if (event.runId !== this.activeRunId) return;
        this.state.status = event.stopped ? 'stopped' : event.success ? 'success' : 'failed';
        this.state.finishedAt = new Date().toISOString();
        this.state.reportPath = event.reportPath ?? null;
        this.state.midsceneReportPath = event.midsceneReportPath ?? null;
        this.state.error = event.error ?? null;
        if (event.summary) {
          this.state.passed = event.summary.passed;
          this.state.failed = event.summary.failed;
          this.state.skipped = event.summary.skipped;
        }
        if (event.stopped) {
          for (const d of this.state.devices) {
            if (d.status === 'running') {
              d.status = 'stopped';
              d.error = d.error ?? '用户已停止';
            }
          }
        }
        break;
      }

      case 'phase':
        if (!this.isActiveBatchEvent(event.runId)) return;
        if (event.deviceId) {
          const slot = this.ensureDevice(event.deviceId);
          slot.phase = event.label;
          this.state.focusDeviceId = event.deviceId;
        }
        this.state.phase = event.label;
        break;

      case 'page:start':
        if (!this.isActiveBatchEvent(event.runId)) return;
        this.state.pageId = event.pageId;
        this.state.pageTitle = event.title;
        this.state.pageIndex = event.pageIndex;
        this.state.pageTotal = event.pageTotal;
        this.state.stepTotal = event.stepTotal;
        this.state.stepIndex = 0;
        if (event.deviceId) this.state.focusDeviceId = event.deviceId;
        break;

      case 'step:start':
        if (!this.isActiveBatchEvent(event.runId)) return;
        this.state.stepIndex = event.stepIndex;
        this.state.stepTotal = event.stepTotal;
        this.state.currentStep = `${event.section} / ${event.label}`;
        this.state.currentExpectation = event.expectation ?? `${event.stepType} 步骤执行完成`;
        if (event.deviceId) {
          const slot = this.ensureDevice(event.deviceId);
          slot.currentStep = this.state.currentStep;
          slot.currentExpectation = this.state.currentExpectation;
          this.state.focusDeviceId = event.deviceId;
        }
        break;

      case 'case':
        if (!this.isActiveBatchEvent(event.runId)) return;
        this.state.currentCase = event.name;
        if (event.deviceId) {
          const slot = this.ensureDevice(event.deviceId);
          if (event.status === 'passed') slot.passed += 1;
          if (event.status === 'failed') slot.failed += 1;
          if (event.status === 'skipped') slot.skipped += 1;
          this.state.focusDeviceId = event.deviceId;
          this.recomputeAggregates();
        } else {
          if (event.status === 'passed') this.state.passed += 1;
          if (event.status === 'failed') this.state.failed += 1;
          if (event.status === 'skipped') this.state.skipped += 1;
        }
        break;

      case 'ai:start':
        if (!this.isActiveBatchEvent(event.runId)) return;
        if (event.deviceId) this.state.focusDeviceId = event.deviceId;
        break;

      case 'l5':
        if (!this.isActiveBatchEvent(event.runId)) return;
        this.state.currentStep = `[L5] ${event.name}`;
        this.state.currentExpectation = event.detail ?? event.name;
        if (event.deviceId) this.state.focusDeviceId = event.deviceId;
        break;

      default:
        break;
    }
  }

  nextCaseIndex(): number {
    this.caseIndex += 1;
    return this.caseIndex;
  }

  getActiveRunId(): string | null {
    return this.activeRunId;
  }

  private persist(): void {
    try {
      mkdirSync(LIVE_DIR, { recursive: true });
      writeFileSync(join(LIVE_DIR, 'run-state.json'), JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // dashboard 不可用时仍允许 CLI 跑测
    }
  }
}

export const progressEmitter = new ProgressEmitter();

export function summarizePrompt(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first.slice(0, 500);
  if (first && typeof first === 'object' && 'prompt' in first && typeof (first as { prompt: unknown }).prompt === 'string') {
    return (first as { prompt: string }).prompt.slice(0, 500);
  }
  try {
    return JSON.stringify(first).slice(0, 500);
  } catch {
    return String(first).slice(0, 500);
  }
}
