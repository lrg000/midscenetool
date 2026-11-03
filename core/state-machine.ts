import { connectSession } from './ai-agent.js';
import { executePageFlow } from './page-executor.js';
import type { AgentSession, PageState, StateMachineContext } from './types.js';
import { sleep } from './utils.js';
import { progressEmitter } from './progress-emitter.js';

const PHASE_LABELS: Record<PageState, string> = {
  INIT: '初始化',
  CONNECTING: '连接设备',
  PAGE_READY: '等待页面就绪',
  TESTING: '执行测试',
  SUBMITTING: '提交跳转',
  FINISHED: '已完成',
  FAILED: '失败',
};

function emitPhase(state: PageState): void {
  const runId = progressEmitter.getActiveRunId();
  if (!runId) return;
  progressEmitter.emitEvent({
    type: 'phase',
    runId,
    phase: state,
    label: PHASE_LABELS[state] ?? state,
  });
}

type StateHandler = (ctx: StateMachineContext) => Promise<PageState | 'STAY'>;

const transitions: Record<PageState, StateHandler> = {
  INIT: async () => 'CONNECTING',

  CONNECTING: async (ctx) => {
    await connectSession(ctx.session);
    console.log('  等待页面稳定...');
    await sleep(ctx.session.env.timing.pageReady);
    return 'PAGE_READY';
  },

  PAGE_READY: async () => 'TESTING',

  TESTING: async (ctx) => {
    await executePageFlow(ctx.session);
    return 'FINISHED';
  },

  SUBMITTING: async () => 'FINISHED',
  FINISHED: async () => 'STAY',
  FAILED: async () => 'STAY',
};

export class PageStateMachine {
  private ctx: StateMachineContext;

  constructor(session: AgentSession) {
    this.ctx = {
      session,
      currentState: 'INIT',
      flowIndex: 0,
      currentSection: '',
    };
  }

  async run(): Promise<void> {
    while (this.ctx.currentState !== 'FINISHED' && this.ctx.currentState !== 'FAILED') {
      emitPhase(this.ctx.currentState);
      const handler = transitions[this.ctx.currentState];
      const next = await handler(this.ctx);
      if (next === 'STAY') continue;
      this.ctx.currentState = next;
    }
    emitPhase(this.ctx.currentState);
  }
}

export { executePageFlow, runFlowStep } from './page-executor.js';

export async function runPageTest(
  pageId: string,
  options?: { runId?: string; deviceId?: string },
): Promise<{ session: AgentSession; runId: string }> {
  const { createAgentSession } = await import('./ai-agent.js');
  const { clearResults } = await import('./test-context.js');
  const { finalizeRun } = await import('../reports/report-generator.js');

  clearResults();
  const runId = options?.runId ?? new Date().toISOString().replace(/[:.]/g, '-');

  console.log(`\n========== ${pageId} 页面自动化测试（框架） ==========\n`);

  const session = await createAgentSession({ pageId, runId, deviceId: options?.deviceId });
  const sm = new PageStateMachine(session);

  try {
    await sm.run();
    session.reportFilePath = session.agent.reportFile ?? null;
    finalizeRun(session);
  } catch (err) {
    session.reportFilePath = session.agent.reportFile ?? null;
    finalizeRun(session, err instanceof Error ? err.message : String(err));
    throw err;
  }

  return { session, runId };
}

export { runBusinessFlow } from './business-runner.js';
