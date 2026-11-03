import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y24 Glimmer Frame A 面 — Photos / Albums / 加密 / 持久化
 * 云效 PRD: Y24面包开发 (e03110351ae85d71af463beadd / WIFO-1958)
 *
 *   npm run test:aside:y24
 */
Promise.resolve(
  runAsidePackage('y24', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
