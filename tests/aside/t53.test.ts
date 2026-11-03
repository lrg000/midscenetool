import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * T53 Anantapur Chakra 贷款壳 A 面（云效 WIFO-1993）
 *
 * 协议 → Mobile OTP → KYC → 额度/借款/还款 → 我的
 * 账号强制 9110001501 / OTP 1234（覆盖 .env）
 *
 *   npm run test:aside:t53
 *   $env:ASIDE_SKIP_LAUNCH = "1"
 */
process.env.TEST_MOBILE = '9110001501';
process.env.TEST_OTP = '1234';

Promise.resolve(
  runAsidePackage('t53', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
