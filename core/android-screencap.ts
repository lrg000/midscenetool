import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AndroidDevice } from '@midscene/android';

const execFileAsync = promisify(execFile);

function looksLikePng(buf: Buffer): boolean {
  return buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/** Windows / 旧系统 `adb shell screencap -p` 常把 CR 插进 PNG 头 */
function normalizePng(buf: Buffer): Buffer {
  let out = buf;
  if (out.length >= 2 && out[0] === 0x0d && out[1] === 0x0a) out = out.subarray(2);
  if (out.length >= 3 && out[0] === 0x89 && out[1] === 0x0d && out[2] === 0x50) {
    out = Buffer.concat([out.subarray(0, 1), out.subarray(2)]);
  }
  return out;
}

async function screenshotViaExecOut(device: AndroidDevice): Promise<string> {
  const adb = await device.getAdb();
  const adbPath = (adb as { executable?: { path?: string } }).executable?.path ?? 'adb';
  const udid = (device as { deviceId: string }).deviceId;
  const { stdout } = await execFileAsync(adbPath, ['-s', udid, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const raw = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const buf = normalizePng(raw);
  if (!looksLikePng(buf) || buf.length < 1024) {
    throw new Error(`adb exec-out screencap 无效（${buf.length} bytes）。设备 API 过低或 USB 调试异常。`);
  }
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const PATCHED = new WeakSet<object>();

/**
 * API 27 等机型上 Midscene fallback（screencap -p 再 pull）经常得到 0 字节。
 * 失败后改走 exec-out，避免 L3 / 冷启直接崩。
 */
export function patchAndroidScreenshot(device: AndroidDevice): void {
  if (PATCHED.has(device)) return;
  PATCHED.add(device);
  const original = device.screenshotBase64.bind(device);
  device.screenshotBase64 = async () => {
    try {
      return await original();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/buffer size 0|Invalid screenshot|Fallback screenshot|validateScreenshot/i.test(msg)) {
        throw err;
      }
      console.log('  设备截图为空（常见于 Android 8 / Windows adb pull），改用 exec-out...');
      return screenshotViaExecOut(device);
    }
  };
}
