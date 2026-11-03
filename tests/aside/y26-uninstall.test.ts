import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y26 TC-023 卸载清数据（破坏性）
 *   $env:Y26_APK_PATH = "F:\\path\\to\\app.apk"
 *   $env:Y26_RUN_UNINSTALL = "1"
 *   npm run test:aside:y26:uninstall
 */
if (process.env.Y26_RUN_UNINSTALL !== '1') {
  console.log('跳过 Y26 卸载专项：设置 Y26_RUN_UNINSTALL=1 且提供 Y26_APK_PATH 后执行。');
  process.exit(0);
}

Promise.resolve(
  runAsidePackage('y26-uninstall', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
  }).catch((err) => {
    console.error('\nA 面卸载测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
