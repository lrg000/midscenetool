import 'dotenv/config';
import { runPageTest } from '../core/state-machine.js';

Promise.resolve(
  runPageTest('kyc-liveness').catch((err) => {
    console.error('\n测试执行异常:', err instanceof Error ? err.message : err);
  }),
);
