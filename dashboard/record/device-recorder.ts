import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AndroidAgent, AndroidDevice, getConnectedDevices } from '@midscene/android';
import { progressEmitter } from '../../core/progress-emitter.js';
import { getActiveTrace, recordsDir } from './session-store.js';

let device: AndroidDevice | null = null;
let agent: AndroidAgent | null = null;
let deviceUdid: string | null = null;

function log(message: string): void {
  const runId = getActiveTrace()?.sessionId ?? 'record';
  progressEmitter.emitEvent({ type: 'log', runId, message: `[record] ${message}` });
  console.log(`[record] ${message}`);
}

export async function startDeviceRecord(options: {
  deviceId?: string;
  androidPackage?: string;
  skipLaunch?: boolean;
}): Promise<{ deviceId: string }> {
  if (device) throw new Error('真机录制会话已占用设备');

  const devices = await getConnectedDevices();
  if (!devices.length) throw new Error('未检测到已连接的 Android 设备');

  const preferred = options.deviceId?.trim();
  const matched = preferred
    ? devices.find((d) => d.udid === preferred)
    : undefined;
  if (preferred && !matched) {
    throw new Error(
      `未找到设备 ${preferred}；当前: ${devices.map((d) => d.udid).join(', ') || '无'}`,
    );
  }
  deviceUdid = matched?.udid ?? devices[0].udid;
  device = new AndroidDevice(deviceUdid);
  await device.connect();

  const sessionId = getActiveTrace()?.sessionId ?? 'record';
  agent = new AndroidAgent(device, {
    testId: `record-${sessionId}`,
    groupName: 'Dashboard Record',
    reportFileName: `record-${sessionId}`,
    generateReport: false,
    aiActionContext: 'Recording Android UI steps for Midscene A-side YAML generation.',
  });

  const pkg = options.androidPackage?.trim();
  if (pkg && !options.skipLaunch) {
    log(`启动 App: ${pkg}`);
    try {
      await agent.launch(pkg);
    } catch (err) {
      log(`启动失败（可继续手动打开）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`真机录制已连接: ${deviceUdid}`);
  return { deviceId: deviceUdid };
}

export async function stopDeviceRecord(): Promise<void> {
  try {
    if (device) await device.destroy().catch(() => undefined);
  } finally {
    device = null;
    agent = null;
    deviceUdid = null;
    log('真机录制已断开');
  }
}

export function isDeviceRecording(): boolean {
  return device != null;
}

export function getDeviceUdid(): string | null {
  return deviceUdid;
}

function decodeScreenshotBase64(raw: string): Buffer {
  const base64 = raw.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64, 'base64');
}

/** 截屏到 midscene_run/records，返回可经 /midscene_run/ 访问的相对 URL */
export async function captureRecordScreenshot(): Promise<{
  path: string;
  url: string;
}> {
  if (!device) throw new Error('真机未连接');
  const trace = getActiveTrace();
  const sessionId = trace?.sessionId ?? 'shot';
  mkdirSync(recordsDir(), { recursive: true });
  const fileName = `${sessionId}-shot.png`;
  const filePath = join(recordsDir(), fileName);
  const base64 = await device.screenshotBase64();
  const buffer = decodeScreenshotBase64(base64);
  if (!buffer.length) throw new Error('截屏为空');
  writeFileSync(filePath, buffer);
  const url = `/midscene_run/records/${fileName}`;
  log(`截屏已保存: ${url}`);
  return { path: filePath, url };
}

/**
 * 用 Midscene 抽当前屏可见主文案，供 verify / wait-page 使用。
 * 失败时返回空字符串（不抛），避免阻断录制。
 */
export async function extractScreenSummary(): Promise<string> {
  if (!agent) throw new Error('真机 Agent 未就绪');
  try {
    const result = await agent.aiQuery(
      'List the main visible title and 3-6 key button or label texts on screen, ' +
        'as a short English comma-separated string. No explanation.',
    );
    const text =
      typeof result === 'string'
        ? result.trim()
        : result != null
          ? String(result).trim()
          : '';
    log(`屏幕文案摘要: ${text.slice(0, 120)}`);
    return text;
  } catch (err) {
    log(`抽取文案失败: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}
