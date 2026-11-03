import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * Y27 Sakhi Rangoli (PicBox) A 面 — Photos / Albums / 加密 / 持久化
 * 云效 PRD: Y27面包开发 (f247cecc0ee66a2ea9b3c7d6aa / WIFO-1962)
 *
 *   npm run test:aside:y27
 */
Promise.resolve(
  runAsidePackage('y27', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
