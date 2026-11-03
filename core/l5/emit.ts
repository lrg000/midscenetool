import { progressEmitter } from '../progress-emitter.js';
import type { AgentSession } from '../types.js';

export function emitL5(
  session: AgentSession | undefined,
  payload: {
    channel: 'api' | 'sql' | 'rule' | 'ui' | 'diagnose';
    status: 'passed' | 'failed' | 'skipped';
    name: string;
    detail?: string;
    reportPath?: string;
  },
): void {
  const runId = progressEmitter.getActiveRunId() ?? session?.runId ?? 'l5';
  progressEmitter.emitEvent({
    type: 'l5',
    runId,
    ...payload,
  });
}
