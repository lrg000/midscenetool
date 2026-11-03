import type { AndroidAgent } from '@midscene/android';
import type { AiMetrics } from './ai-metrics.js';
import { progressEmitter, summarizePrompt } from './progress-emitter.js';

const AI_METHODS = new Set([
  'aiTap',
  'aiRightClick',
  'aiDoubleClick',
  'aiHover',
  'aiInput',
  'aiKeyboardPress',
  'aiScroll',
  'aiPinch',
  'aiLongPress',
  'aiClearInput',
  'aiAct',
  'aiAction',
  'aiQuery',
  'aiBoolean',
  'aiNumber',
  'aiString',
  'aiAsk',
  'aiLocate',
  'aiAssert',
  'aiWaitFor',
  'ai',
  'runMarkdown',
  'runGherkinScenario',
  'runYaml',
]);

export function wrapAgentWithMetrics(agent: AndroidAgent, metrics: AiMetrics): AndroidAgent {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function' || !AI_METHODS.has(prop)) {
        if (typeof value === 'function') return value.bind(target);
        return value;
      }

      return async (...args: unknown[]) => {
        const start = Date.now();
        const runId = progressEmitter.getActiveRunId();
        const prompt = summarizePrompt(args);
        if (runId) {
          progressEmitter.emitEvent({ type: 'ai:start', runId, method: prop, prompt });
        }
        try {
          const result = await value.apply(target, args);
          metrics.record(prop, Date.now() - start);
          if (runId) {
            progressEmitter.emitEvent({
              type: 'ai:end',
              runId,
              method: prop,
              prompt,
              durationMs: Date.now() - start,
              success: true,
            });
          }
          return result;
        } catch (err) {
          metrics.record(prop, Date.now() - start, false);
          if (runId) {
            progressEmitter.emitEvent({
              type: 'ai:end',
              runId,
              method: prop,
              prompt,
              durationMs: Date.now() - start,
              success: false,
            });
          }
          throw err;
        }
      };
    },
  }) as AndroidAgent;
}
