import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AndroidDevice } from '@midscene/android';

function decodeScreenshotBase64(raw: string): Buffer {
  const base64 = raw.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64, 'base64');
}

/**
 * 失败截图保存到本机 midscene_run/screenshots。
 * 注意：AndroidDevice.forceScreenshot 会把 path 传给设备端 yadb，不能用于 PC 路径。
 */
export async function captureFailureScreenshot(
  device: AndroidDevice,
  screenshotsDir: string,
  runId: string,
  testName: string,
): Promise<string | null> {
  try {
    const dir = resolve(screenshotsDir);
    mkdirSync(dir, { recursive: true });
    const safeName = testName.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 80);
    const filePath = join(dir, `${runId}-${safeName}.png`);

    const base64 = await device.screenshotBase64();
    const buffer = decodeScreenshotBase64(base64);
    if (!buffer.length) return null;

    writeFileSync(filePath, buffer);
    if (!existsSync(filePath) || statSync(filePath).size === 0) return null;

    return filePath;
  } catch {
    return null;
  }
}
