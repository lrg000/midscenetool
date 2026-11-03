import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y25 TC-021 — 卸载后本地贴纸数据清除（破坏性）
 *
 *   $env:Y25_APK_PATH = "F:\path\to\app.apk"
 *   $env:Y25_RUN_UNINSTALL = "1"
 *   npm run test:aside:y25:uninstall
 */
const apkPath = process.env.Y25_APK_PATH?.trim() || process.env.ASIDE_APK_PATH?.trim();
const confirmed = process.env.Y25_RUN_UNINSTALL === '1';

if (!confirmed) {
  console.log(
    '\n跳过 TC-021 卸载测试：设置 Y25_RUN_UNINSTALL=1 后重试（会卸载并重装 App）。',
  );
  process.exit(0);
}

if (!apkPath) {
  console.error('\nTC-021 需要 Y25_APK_PATH（或 ASIDE_APK_PATH）指向本地 apk。');
  process.exitCode = 1;
  process.exit(1);
}

Promise.resolve(
  runAsidePackage('y25-uninstall', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
  }).catch((err) => {
    console.error('\nTC-021 测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
