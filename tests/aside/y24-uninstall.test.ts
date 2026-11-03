import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y24 TC-026 卸载清数据（破坏性）
 *   $env:Y24_APK_PATH = "F:\\path\\to\\app.apk"
 *   $env:Y24_RUN_UNINSTALL = "1"
 *   npm run test:aside:y24:uninstall
 */
if (process.env.Y24_RUN_UNINSTALL !== '1') {
  console.log('跳过 Y24 卸载专项：设置 Y24_RUN_UNINSTALL=1 且提供 Y24_APK_PATH 后执行。');
  process.exit(0);
}

Promise.resolve(
  runAsidePackage('y24-uninstall', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
  }).catch((err) => {
    console.error('\nA 面卸载测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
