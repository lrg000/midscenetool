import { isRunActive } from '../runner.js';
import { generateAsideFromTrace } from './aside-generator.js';
import {
  captureRecordScreenshot,
  extractScreenSummary,
  isDeviceRecording,
  startDeviceRecord,
  stopDeviceRecord,
} from './device-recorder.js';
import {
  isPlaywrightRecording,
  startPlaywrightRecord,
  stopPlaywrightRecord,
} from './playwright-recorder.js';
import {
  addStepFromRequest,
  clearActive,
  createTrace,
  getActiveTrace,
  isRecordActive,
  markStopped,
  persistTrace,
  resolveActive,
  startNewPage,
  statusPayload,
} from './session-store.js';
import type {
  AddStepRequest,
  GenerateRequest,
  GenerateResult,
  NewPageRequest,
  RecordTrace,
  StartRecordRequest,
} from './types.js';

export type {
  AddStepRequest,
  GenerateRequest,
  GenerateResult,
  NewPageRequest,
  RecordTrace,
  StartRecordRequest,
} from './types.js';

export { isRecordActive, statusPayload, getActiveTrace };

function assertCanStart(): void {
  if (isRunActive()) {
    throw new Error('视觉执行进行中，请先停止跑测再开始录制');
  }
  if (isRecordActive()) {
    throw new Error('已有录制会话，请先停止当前录制');
  }
}

export async function startRecord(req: StartRecordRequest): Promise<RecordTrace> {
  assertCanStart();
  if (req.mode !== 'browser' && req.mode !== 'device') {
    throw new Error('mode 必须是 browser 或 device');
  }
  if (req.mode === 'browser' && !req.url?.trim()) {
    throw new Error('浏览器录制需要 url');
  }

  const trace = createTrace(req);
  try {
    if (req.mode === 'browser') {
      await startPlaywrightRecord(req.url!);
    } else {
      const { deviceId } = await startDeviceRecord({
        deviceId: req.deviceId,
        androidPackage: req.androidPackage || trace.meta.androidPackage,
        skipLaunch: req.skipLaunch ?? trace.meta.skipLaunch,
      });
      trace.meta.deviceId = deviceId;
      persistTrace(trace);
    }
  } catch (err) {
    markStopped(trace.sessionId);
    clearActive();
    await stopPlaywrightRecord().catch(() => undefined);
    await stopDeviceRecord().catch(() => undefined);
    throw err;
  }
  return getActiveTrace()!;
}

export async function stopRecord(sessionId?: string): Promise<RecordTrace> {
  const trace = resolveActive(sessionId);
  if (trace.mode === 'browser' || isPlaywrightRecording()) {
    await stopPlaywrightRecord();
  }
  if (trace.mode === 'device' || isDeviceRecording()) {
    await stopDeviceRecord();
  }
  const stopped = markStopped(trace.sessionId);
  return stopped;
}

export function addRecordStep(req: AddStepRequest, sessionId?: string): RecordTrace {
  if (!isRecordActive() && sessionId) {
    // allow adding only while recording
  }
  const trace = resolveActive(sessionId);
  if (trace.status !== 'recording') {
    throw new Error('会话已停止，无法追加步骤');
  }
  return addStepFromRequest(req, sessionId);
}

export function addRecordPage(req: NewPageRequest, sessionId?: string): RecordTrace {
  return startNewPage(req, sessionId);
}

export async function screenshotRecord(): Promise<{ path: string; url: string }> {
  if (!isDeviceRecording()) throw new Error('仅真机录制支持截屏');
  return captureRecordScreenshot();
}

export async function suggestVerifyFromScreen(): Promise<{
  summary: string;
  trace: RecordTrace | null;
}> {
  if (!isDeviceRecording()) throw new Error('仅真机录制支持从屏幕生成 verify');
  const summary = await extractScreenSummary();
  if (!summary) {
    return { summary: '', trace: null };
  }
  const trace = addStepFromRequest({
    kind: 'verify',
    text: summary.slice(0, 200),
    label: '录制屏文案校验',
    assertPrompt: `The screen shows these key texts (or equivalent): ${summary}. Answer only true or false.`,
  });
  return { summary, trace };
}

export function generateFromRecord(req: GenerateRequest): GenerateResult {
  if (isRecordActive()) {
    throw new Error('请先停止录制再转换落盘');
  }
  return generateAsideFromTrace(req.sessionId, !!req.overwrite);
}

export function getTrace(sessionId?: string): RecordTrace {
  return resolveActive(sessionId);
}
