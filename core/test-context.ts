import type { TestResult, TestSummary } from './types.js';
import { calcPassRate, shortenError, isAdbError } from './utils.js';
import { captureFailureScreenshot } from './screenshot.js';
import { resolve } from 'node:path';
import type { AndroidAgent, AndroidDevice } from '@midscene/android';
import { progressEmitter } from './progress-emitter.js';

const results: TestResult[] = [];

export interface ActiveRunContext {
  agent?: AndroidAgent;
  device?: AndroidDevice;
  screenshotsDir?: string;
  runId?: string;
}

let activeRunContext: ActiveRunContext | null = null;

export function setActiveRunContext(ctx: ActiveRunContext | null): void {
  activeRunContext = ctx;
}

export function getActiveRunContext(): ActiveRunContext | null {
  return activeRunContext;
}

export function getResults(): TestResult[] {
  return results;
}

export function clearResults(): void {
  results.length = 0;
}

export function buildTestSummary(): TestSummary {
  const passed = results.filter((r) => r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.passed && !r.skipped).length;
  const total = results.length;
  return { total, passed, failed, skipped, passRate: calcPassRate(passed, total) };
}

function record(
  name: string,
  passed: boolean,
  error?: string,
  options?: { skipped?: boolean; skipReason?: string },
) {
  results.push({
    name,
    passed: options?.skipped ? false : passed,
    skipped: options?.skipped,
    error,
    skipReason: options?.skipReason,
    timestamp: new Date().toISOString(),
  });
  const icon = options?.skipped ? '⊘' : passed ? '✓' : '✗';
  const suffix = options?.skipped
    ? ` — ${options?.skipReason ?? '已跳过'}`
    : error
      ? ` — ${shortenError(error)}`
      : '';
  console.log(`  ${icon} ${name}${suffix}`);

  const runId = progressEmitter.getActiveRunId();
  if (runId) {
    progressEmitter.emitEvent({
      type: 'case',
      runId,
      name,
      status: options?.skipped ? 'skipped' : passed ? 'passed' : 'failed',
      error: error ? shortenError(error) : undefined,
      caseIndex: progressEmitter.nextCaseIndex(),
    });
  }
}

export function recordPassed(name: string): void {
  record(name, true);
}

export function recordFailed(name: string, error: string): void {
  record(name, false, error);
}

export function recordSkipped(name: string, reason: string): void {
  record(name, false, undefined, { skipped: true, skipReason: reason });
}

export async function runTest(
  name: string,
  fn: () => Promise<void>,
  options?: {
    agent?: AndroidAgent;
    device?: AndroidDevice;
    screenshotsDir?: string;
    runId?: string;
  },
): Promise<void> {
  const ctx = {
    agent: options?.agent ?? activeRunContext?.agent,
    device: options?.device ?? activeRunContext?.device,
    screenshotsDir: options?.screenshotsDir
      ? resolve(options.screenshotsDir)
      : activeRunContext?.screenshotsDir,
    runId: options?.runId ?? activeRunContext?.runId,
  };

  try {
    await fn();
    record(name, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(name, false, message);
    if (ctx.device && ctx.screenshotsDir && ctx.runId && !isAdbError(err)) {
      const shot = await captureFailureScreenshot(
        ctx.device,
        ctx.screenshotsDir,
        ctx.runId,
        name,
      );
      if (shot) console.log(`  截图: ${shot}`);
    }
  }
}
