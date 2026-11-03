import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * T42.RajWise A 面全量：冷启/协议 → OTP 登录 → 登录后 Figma 文案校验
 * Figma: https://www.figma.com/design/WyXM6yVCpAI7TmrgGuYPZY/T42.RajWise
 *
 *   npm run test:aside:t42
 *
 * 仅登录后（已在 Home）: npm run test:aside:t42-postlogin
 */
Promise.resolve(
  runAsidePackage('t42', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
