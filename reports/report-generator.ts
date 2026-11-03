import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession, TestResult, TestSummary } from '../core/types.js';
import { buildTestSummary, getResults, setActiveRunContext } from '../core/test-context.js';
import { shortenError } from '../core/utils.js';
import type { MetricsSnapshot } from '../core/ai-metrics.js';
import { flushRunArtifacts } from '../core/run-artifacts.js';
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inferResultGroup(name: string): string {
  if (name.includes('Agree') || name.includes('Login') || name.includes('OTP') || name.includes('Verify & Login') || name.includes('登录') || name.includes('原生输入')) return '登录';
  if (name.endsWith(' - 随机选一项并回显一致')) return '下拉选项';
  if (name.includes('失焦')) return '输入框校验';
  if (name.includes('通讯录') || name.includes('选择联系人')) return '通讯录';
  if (name.includes('Repay') || name.includes('还款')) return '还款';
  if (name.includes('Apply') || name.includes('Success') || name.includes('Confirm') || name.includes('Begin Verification') || name.includes('申请')) return '申请';
  if (name.includes('页面校验') || name.endsWith(' - 页面校验')) return '页面校验';
  if (name.includes(' - tap-') || name.includes(' - wait-') || name.includes(' - kyc-') || name.includes('handle-permissions') || name.includes('usage-access') || name.includes('dismiss-home')) return 'KYC/原生步骤';
  if (name.includes('勾选')) return '勾选框';
  if (name.includes('Next') || name.includes('跳转')) return '提交跳转';
  return '其他';
}

function resultStatus(r: TestResult): 'passed' | 'failed' | 'skipped' {
  if (r.skipped) return 'skipped';
  return r.passed ? 'passed' : 'failed';
}

function buildMetricsSection(metrics: MetricsSnapshot | null): string {
  if (!metrics) return '';
  const tokens = metrics.tokens;
  const tokenRows = tokens
    ? `<tr><td>LLM 请求次数</td><td>${tokens.calls}</td></tr>
       <tr><td>Prompt Tokens</td><td>${tokens.promptTokens.toLocaleString()}</td></tr>
       <tr><td>Completion Tokens</td><td>${tokens.completionTokens.toLocaleString()}</td></tr>
       <tr><td>Total Tokens</td><td>${tokens.totalTokens.toLocaleString()}</td></tr>
       <tr><td>模型耗时 (ms)</td><td>${tokens.totalCostMs.toLocaleString()}</td></tr>`
    : '';
  const kindRows = Object.entries(metrics.summary.byKind)
    .sort((a, b) => b[1].count - a[1].count)
    .map(
      ([kind, stat]) =>
        `<tr><td>${escapeHtml(kind)}</td><td>${stat.count}</td><td>${stat.totalMs} ms</td></tr>`,
    )
    .join('');
  return `<section class="group">
    <h2>AI 调用与 Token</h2>
    <table>
      <tbody>
        <tr><td>框架层 AI 调用</td><td>${metrics.summary.total}</td></tr>
        <tr><td>累计耗时</td><td>${metrics.summary.totalMs} ms（均 ${metrics.summary.avgMs} ms）</td></tr>
        ${tokenRows}
      </tbody>
    </table>
    <h3 style="margin-top:16px;font-size:0.95rem;">按方法统计</h3>
    <table>
      <thead><tr><th>方法</th><th>次数</th><th>耗时</th></tr></thead>
      <tbody>${kindRows}</tbody>
    </table>
  </section>`;
}

function saveVisualReport(
  session: AgentSession,
  results: TestResult[],
  summary: TestSummary,
  metrics: MetricsSnapshot | null,
): string {
  const outputDir = join(process.cwd(), session.env.paths.midsceneOutput);
  mkdirSync(outputDir, { recursive: true });
  const reportFile = join(outputDir, `${session.meta.id}-${session.runId}-report.html`);
  const finishedAt = new Date().toISOString();
  const passRateWidth = Math.min(100, Math.max(0, summary.passRate));

  const grouped = new Map<string, TestResult[]>();
  for (const r of results) {
    const group = inferResultGroup(r.name);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(r);
  }
  const groupOrder = ['登录', '页面校验', '申请', '下拉选项', '输入框校验', '通讯录', '勾选框', 'KYC/原生步骤', '还款', '提交跳转', '其他'];

  const groupSections = groupOrder
    .filter((g) => grouped.has(g))
    .map((group) => {
      const items = grouped.get(group)!;
      const rows = items
        .map((r) => {
          const status = resultStatus(r);
          const badge =
            status === 'passed'
              ? '<span class="badge pass">通过</span>'
              : status === 'skipped'
                ? '<span class="badge skip">跳过</span>'
                : '<span class="badge fail">失败</span>';
          const detail =
            status === 'skipped'
              ? escapeHtml(r.skipReason ?? '已跳过')
              : status === 'failed'
                ? escapeHtml(shortenError(r.error ?? '', 300))
                : '—';
          const time = new Date(r.timestamp).toLocaleString('zh-CN');
          return `<tr class="row-${status}">
            <td>${badge}</td>
            <td>${escapeHtml(r.name)}</td>
            <td class="detail">${detail}</td>
            <td class="time">${time}</td>
          </tr>`;
        })
        .join('');
      const gPassed = items.filter((r) => r.passed).length;
      const gSkipped = items.filter((r) => r.skipped).length;
      const gFailed = items.filter((r) => !r.passed && !r.skipped).length;
      return `<section class="group">
        <h2>${escapeHtml(group)} <span class="group-meta">${gPassed} 通过 / ${gFailed} 失败 / ${gSkipped} 跳过</span></h2>
        <table>
          <thead><tr><th>状态</th><th>用例名称</th><th>说明</th><th>时间</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const midsceneLink = session.reportFilePath
    ? `<p class="link">Midscene 步骤报告：<a href="file:///${session.reportFilePath.replace(/\\/g, '/')}">${escapeHtml(session.reportFilePath)}</a></p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(session.meta.title)} 测试汇报 — ${escapeHtml(session.runId)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f0f2f5; color: #1a1a2e; line-height: 1.5; padding: 32px 24px; }
    .container { max-width: 1100px; margin: 0 auto; }
    header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: #fff; border-radius: 12px; padding: 32px 36px; margin-bottom: 24px; }
    header h1 { font-size: 1.6rem; font-weight: 600; margin-bottom: 8px; }
    header .meta { opacity: 0.85; font-size: 0.9rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 10px; padding: 20px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .card .num { font-size: 2rem; font-weight: 700; }
    .card .label { font-size: 0.85rem; color: #666; margin-top: 4px; }
    .card.total .num { color: #0f3460; }
    .card.passed .num { color: #16a34a; }
    .card.failed .num { color: #dc2626; }
    .card.skipped .num { color: #ca8a04; }
    .card.rate .num { color: #2563eb; }
    .rate-bar { background: #fff; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .rate-bar .bar-track { height: 12px; background: #e5e7eb; border-radius: 6px; overflow: hidden; margin-top: 10px; }
    .rate-bar .bar-fill { height: 100%; background: linear-gradient(90deg, #16a34a, #22c55e); border-radius: 6px; }
    .group { background: #fff; border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .group h2 { font-size: 1.1rem; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb; }
    .group-meta { font-size: 0.8rem; font-weight: 400; color: #888; margin-left: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th { text-align: left; padding: 10px 12px; background: #f8fafc; color: #64748b; font-weight: 600; }
    td { padding: 10px 12px; border-top: 1px solid #f1f5f9; vertical-align: top; }
    tr.row-failed { background: #fef2f2; }
    tr.row-skipped { background: #fffbeb; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge.pass { background: #dcfce7; color: #166534; }
    .badge.fail { background: #fee2e2; color: #991b1b; }
    .badge.skip { background: #fef3c7; color: #92400e; }
    .detail { color: #64748b; max-width: 360px; word-break: break-word; }
    .time { color: #94a3b8; white-space: nowrap; font-size: 0.82rem; }
    footer { text-align: center; color: #94a3b8; font-size: 0.82rem; margin-top: 24px; }
    .link { margin-top: 12px; font-size: 0.85rem; }
    .link a { color: #93c5fd; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(session.meta.title)} 页面自动化测试 — 汇报</h1>
      <p class="meta">Run ID: ${escapeHtml(session.runId)} &nbsp;|&nbsp; 完成时间: ${new Date(finishedAt).toLocaleString('zh-CN')}</p>
      ${midsceneLink}
    </header>
    <div class="cards">
      <div class="card total"><div class="num">${summary.total}</div><div class="label">总用例</div></div>
      <div class="card passed"><div class="num">${summary.passed}</div><div class="label">通过</div></div>
      <div class="card failed"><div class="num">${summary.failed}</div><div class="label">失败</div></div>
      <div class="card skipped"><div class="num">${summary.skipped}</div><div class="label">跳过</div></div>
      <div class="card rate"><div class="num">${summary.passRate.toFixed(1)}%</div><div class="label">通过率</div></div>
    </div>
    <div class="rate-bar">
      <strong>通过率 ${summary.passRate.toFixed(1)}%</strong>（${summary.passed} / ${summary.total}）
      <div class="bar-track"><div class="bar-fill" style="width:${passRateWidth}%"></div></div>
    </div>
    ${buildMetricsSection(metrics)}
    ${groupSections}    <footer>由 midscenetool 框架自动生成 · ${escapeHtml(finishedAt)}</footer>
  </div>
</body>
</html>`;

  writeFileSync(reportFile, html, 'utf-8');
  return reportFile;
}

function saveOutputJson(
  session: AgentSession,
  results: TestResult[],
  summary: TestSummary,
  metrics: MetricsSnapshot | null,
): { jsonFile: string; visualReportFile: string } {
  const outputDir = join(process.cwd(), session.env.paths.midsceneOutput);
  mkdirSync(outputDir, { recursive: true });
  const outputFile = join(outputDir, `${session.meta.id}-${session.runId}.json`);
  const visualReportFile = saveVisualReport(session, results, summary, metrics);

  writeFileSync(
    outputFile,
    JSON.stringify(
      {
        runId: session.runId,
        pageId: session.meta.id,
        finishedAt: new Date().toISOString(),
        summary,
        metrics,
        reportFile: session.reportFilePath,
        visualReportFile,
        results,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return { jsonFile: outputFile, visualReportFile };
}

function logMetricsSummary(metrics: MetricsSnapshot | null): void {
  if (!metrics) return;
  console.log('\n========== AI 指标 ==========');
  console.log(
    `框架 AI 调用: ${metrics.summary.total} 次，累计 ${metrics.summary.totalMs} ms（均 ${metrics.summary.avgMs} ms）`,
  );
  if (metrics.tokens && metrics.tokens.calls > 0) {
    console.log(
      `Token: prompt ${metrics.tokens.promptTokens}, completion ${metrics.tokens.completionTokens}, total ${metrics.tokens.totalTokens}（${metrics.tokens.calls} 次 LLM 请求）`,
    );
  }
  console.log('（指标已写入上方 JSON / HTML 报告）');
}

export function finalizeRun(session: AgentSession, fatalError?: string): TestSummary {
  const metrics = flushRunArtifacts(session);
  const results = getResults();
  const summary = buildTestSummary();
  const { jsonFile, visualReportFile } = saveOutputJson(session, results, summary, metrics);
  setActiveRunContext(null);

  console.log('\n========== 测试汇总 ==========');
  console.log(
    `总计: ${summary.total}  通过: ${summary.passed}  失败: ${summary.failed}  跳过: ${summary.skipped}`,
  );
  console.log(`通过率: ${summary.passRate.toFixed(1)}%  (${summary.passed}/${summary.total})`);
  console.log(`\n测试结果已写入: ${jsonFile}`);
  console.log(`可视化汇报: ${visualReportFile}`);
  if (session.reportFilePath) console.log(`Midscene 报告: ${session.reportFilePath}`);
  logMetricsSummary(metrics);
  if (fatalError) {
    console.log(`\n测试未完成: ${fatalError}`);
    process.exitCode = 1;
    return summary;
  }

  if (summary.failed > 0) {
    console.log('\n失败用例:');
    results
      .filter((r) => !r.passed && !r.skipped)
      .forEach((r) => console.log(`  - ${r.name}: ${shortenError(r.error ?? '', 200)}`));
    process.exitCode = 1;
  } else if (summary.total > 0) {
    console.log('\n全部用例通过!');
  } else {
    process.exitCode = 1;
  }

  return summary;
}