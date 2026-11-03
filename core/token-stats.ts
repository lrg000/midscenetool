import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TokenSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostMs: number;
}

const EMPTY_SUMMARY: TokenSummary = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  totalCostMs: 0,
};

function parseLogLine(line: string): TokenSummary | null {
  const match = line.match(
    /prompt-tokens,\s*(\d+),\s*completion-tokens,\s*(\d+),\s*total-tokens,\s*(\d+),\s*cost-ms,\s*(\d+)/,
  );
  if (!match) return null;
  return {
    calls: 1,
    promptTokens: Number(match[1]),
    completionTokens: Number(match[2]),
    totalTokens: Number(match[3]),
    totalCostMs: Number(match[4]),
  };
}

function parseLogTimestamp(line: string): Date | null {
  const match = line.match(/^\[([^\]]+)\]/);
  if (!match) return null;
  const ts = Date.parse(match[1]);
  return Number.isNaN(ts) ? null : new Date(ts);
}

export function parseTokenStatsFromLog(
  logPath: string,
  since?: Date,
): TokenSummary {
  if (!existsSync(logPath)) return { ...EMPTY_SUMMARY };

  const summary = { ...EMPTY_SUMMARY };
  const lines = readFileSync(logPath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes('prompt-tokens')) continue;
    if (since) {
      const ts = parseLogTimestamp(line);
      if (ts && ts < since) continue;
    }
    const row = parseLogLine(line);
    if (!row) continue;
    summary.calls += 1;
    summary.promptTokens += row.promptTokens;
    summary.completionTokens += row.completionTokens;
    summary.totalTokens += row.totalTokens;
    summary.totalCostMs += row.totalCostMs;
  }

  return summary;
}

export function defaultTokenLogPath(): string {
  return join(process.cwd(), 'midscene_run', 'log', 'ai-profile-stats.log');
}
