import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * T59 Viramgam CardVista A 面（云效 WIFO-2110）
 *
 * 协议 → Phone OTP → Home/Cards/Activity/My → 加卡/账单/部分还款 → 登出再登录
 * 账号强制 9110001559 / OTP 1234（覆盖 .env）
 *
 *   npm run test:aside:t59
 *   $env:ASIDE_SKIP_LAUNCH = "1"
 */
process.env.TEST_MOBILE = '9110001559';
process.env.TEST_OTP = '1234';

Promise.resolve(
  runAsidePackage('t59', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
