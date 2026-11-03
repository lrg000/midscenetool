import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y20 AC-017 — 卸载 App 后 SQLite 数据全部清除（破坏性）
 *
 * 需环境变量：
 *   Y20_APK_PATH  — 本地 apk 绝对路径，用于卸载后重装
 *   Y20_RUN_UNINSTALL=1 — 显式确认（会卸载 com.dailygrid.lifecaptured.app）
 *
 *   set Y20_APK_PATH=F:\path\to\dailygrid.apk
 *   set Y20_RUN_UNINSTALL=1
 *   npm run test:aside:y20:uninstall
 */
const apkPath = process.env.Y20_APK_PATH?.trim();
const confirmed = process.env.Y20_RUN_UNINSTALL === '1';

if (!confirmed) {
  console.log(
    '\n跳过 AC-017 卸载测试：设置 Y20_RUN_UNINSTALL=1 后重试（会卸载并重装 App）。',
  );
  process.exit(0);
}

if (!apkPath) {
  console.error('\nAC-017 需要 Y20_APK_PATH 指向本地 apk 文件。');
  process.exitCode = 1;
  process.exit(1);
}

Promise.resolve(
  runAsidePackage('y20-uninstall', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
  }).catch((err) => {
    console.error('\nAC-017 测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
