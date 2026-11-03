import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y22 Daily Scribble Pad A 面 — Notes 列表 + 新增/详情/删除
 * 云效 PRD: Y22面包开发 (9da8087be8f5e358d958a82bb1 / WIFO-1862)
 *
 *   npm run test:aside:y22
 */
Promise.resolve(
  runAsidePackage('y22', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
