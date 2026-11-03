import 'dotenv/config';
import { runBusinessFlow } from '../core/business-runner.js';

Promise.resolve(
  runBusinessFlow('repay').catch((err) => {
    console.error('\n测试执行异常:', err instanceof Error ? err.message : err);
  }),
);
