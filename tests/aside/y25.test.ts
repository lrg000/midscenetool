import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y25 Chitra Stickers A 面 — Explore + 详情下载 + My Stickers
 * 云效 PRD: Y25面包开发 (1193c1c5bb9b624cdd83471e07 / WIFO-1959)
 *
 *   npm run test:aside:y25
 */
Promise.resolve(
  runAsidePackage('y25', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
