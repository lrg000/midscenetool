import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y28 MastiMagic Craft A 面 — Home / 下载 / Create / My Stickers
 * 云效 PRD: Y28面包开发 (4f5dad82ee7d00e4f0c02229c7 / WIFO-1965)
 *
 *   npm run test:aside:y28
 */
Promise.resolve(
  runAsidePackage('y28', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
