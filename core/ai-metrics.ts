import type { TokenSummary } from './token-stats.js';

export interface MetricRecord {
  kind: string;
  durationMs: number;
  timestamp: string;
  cached?: boolean;
  failed?: boolean;
}

export interface MetricsSnapshot {
  runId: string;
  flushedAt: string;
  summary: {
    total: number;
    cached: number;
    failed: number;
    totalMs: number;
    avgMs: number;
    byKind: Record<string, { count: number; totalMs: number }>;
  };
  tokens?: TokenSummary;
  records: MetricRecord[];
}

/** 内存收集 AI 调用指标，随 midscene_run/output/*.json 一并落盘 */
export class AiMetrics {
  private records: MetricRecord[] = [];

  record(kind: string, durationMs: number, cached = false, failed = false): void {
    this.records.push({
      kind,
      durationMs,
      timestamp: new Date().toISOString(),
      cached,
      failed,
    });
  }

  getSummary() {
    const total = this.records.length;
    const cached = this.records.filter((r) => r.cached).length;
    const failed = this.records.filter((r) => r.failed).length;
    const totalMs = this.records.reduce((sum, r) => sum + r.durationMs, 0);
    const byKind: Record<string, { count: number; totalMs: number }> = {};
    for (const row of this.records) {
      if (!byKind[row.kind]) byKind[row.kind] = { count: 0, totalMs: 0 };
      byKind[row.kind].count += 1;
      byKind[row.kind].totalMs += row.durationMs;
    }
    return {
      total,
      cached,
      failed,
      totalMs,
      avgMs: total ? Math.round(totalMs / total) : 0,
      byKind,
    };
  }

  snapshot(runId: string, tokens?: TokenSummary): MetricsSnapshot {
    return {
      runId,
      flushedAt: new Date().toISOString(),
      summary: this.getSummary(),
      tokens,
      records: this.records,
    };
  }

  flush(runId: string, tokens?: TokenSummary): MetricsSnapshot {
    return this.snapshot(runId, tokens);
  }
}
