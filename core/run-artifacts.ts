import type { AgentSession } from './types.js';
import type { AiMetrics, MetricsSnapshot } from './ai-metrics.js';
import { defaultTokenLogPath, parseTokenStatsFromLog } from './token-stats.js';

export function flushRunArtifacts(
  session: AgentSession & { metrics?: AiMetrics; runStartedAt?: Date },
): MetricsSnapshot | null {
  const metrics = session.metrics;
  if (!metrics) return null;

  const tokenLog = defaultTokenLogPath();
  const tokens = parseTokenStatsFromLog(tokenLog, session.runStartedAt);
  return metrics.flush(session.runId, tokens);
}
