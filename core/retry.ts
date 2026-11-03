import { sleep, isAdbError } from './utils.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    times?: number;
    delayMs?: number;
    label?: string;
    retryIf?: (err: unknown) => boolean;
  },
): Promise<T> {
  const times = options?.times ?? 2;
  const delayMs = options?.delayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (options?.retryIf && !options.retryIf(err)) throw err;
      if (attempt < times) {
        const label = options?.label ? ` (${options.label})` : '';
        console.log(`  重试 ${attempt}/${times - 1}${label}...`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

/** ADB shell / screencap 偶发失败时重试（设备高负载或 yadb 竞态） */
export async function withAdbRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
  return withRetry(fn, {
    times: 3,
    delayMs: 1200,
    label,
    retryIf: isAdbError,
  });
}
