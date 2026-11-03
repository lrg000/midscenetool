import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y20 Daily Grid A 面 — 月历 + 当天行程 CRUD
 * 云效 PRD: Y20面包开发 (0e040308d09761451e8d96019c)
 *
 *   npm run test:aside:y20
 */
Promise.resolve(
  runAsidePackage('y20', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
