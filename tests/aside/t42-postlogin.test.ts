import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * T42.RajWise 登录后 A 面（对齐 Figma 文案/业务）
 * 设备需已登录并停在 A 面 Home（AVAILABLE CREDIT LIMIT）。
 *
 *   npm run test:aside:t42-postlogin
 *
 * 全量（含冷启登录）仍用: npm run test:aside:t42
 */
Promise.resolve(
  runAsidePackage('t42-postlogin', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH !== '0',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
