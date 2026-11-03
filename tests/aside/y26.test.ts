import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y26 Aarambh Calendar A 面 — 月历 + 当天行程 CRUD
 * 云效 PRD: Y26面包开发 (11bbbf3e77b6062cba6f067efd / WIFO-1960)
 *
 *   npm run test:aside:y26
 */
Promise.resolve(
  runAsidePackage('y26', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
