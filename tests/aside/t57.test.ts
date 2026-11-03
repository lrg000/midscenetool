import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Haveri VahanCredit A 面（Dashboard 录制生成）
 * session: 2026-09-29T08-39-23-721Z-ae0c74
 *
 *   npm run test:aside:t57
 */
process.env.TEST_MOBILE = '9110001559';
process.env.TEST_OTP = '1234';

Promise.resolve(
  runAsidePackage('t57', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
