import 'dotenv/config';
import { runAsidePackage } from '../../core/aside-runner.js';

/**
 * T46.Sree Dhan Lekha A 面全量冒烟（对齐 packages/t46/figma/）
 *
 * 流程: bootstrap → login(Phone Code) → home(+Record Transaction 校验返回)
 *       → statistics → profile(+Account Configuration 校验返回)
 *
 * Figma: https://www.figma.com/design/K3Y5QORZ3zy8lNkwz0ABIV/T46.Sree-Dhan-Lekha
 * 用例: packages/t46/cases/t46-figma.nl.txt
 *
 *   npm run test:aside:t46
 *   $env:ASIDE_SKIP_LAUNCH = "1"
 *
 * 账号强制 9110001244 / 123456（覆盖 .env）
 */
process.env.TEST_MOBILE = '9110001244';
process.env.TEST_OTP = '123456';

Promise.resolve(
  runAsidePackage('t46', {
    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',
    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',
  }).catch((err) => {
    console.error('\nA 面测试异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
