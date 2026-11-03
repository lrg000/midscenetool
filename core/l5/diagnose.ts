import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from '../types.js';
import { loadL5Config } from './config.js';
import { emitL5 } from './emit.js';
import { getL5Store, type L5Snapshot } from './types.js';

export async function writeL5Diagnosis(
  session: AgentSession,
  input: {
    kind: 'step-fail' | 'rule-mismatch' | 'explore';
    title: string;
    error?: string;
    snapshot?: L5Snapshot;
  },
): Promise<string | null> {
  const cfg = loadL5Config();
  if (cfg.diagnose?.enabled === false) return null;

  let screen = '';
  try {
    screen = String(
      await session.agent.aiQuery(
        'Summarize the current screen: title, main buttons, any error/toast. ' +
          'One short paragraph in Chinese. No markdown.',
      ),
    );
  } catch {
    screen = '（无法抽取屏幕文案）';
  }

  const store = getL5Store(session);
  const latest = input.snapshot ?? store.snapshots[store.snapshots.length - 1];
  const analysis = [
    `类型: ${input.kind}`,
    `标题: ${input.title}`,
    input.error ? `错误: ${input.error}` : '',
    `屏幕: ${screen}`,
    latest
      ? `最近快照: UI=${JSON.stringify(latest.ui)} API=${JSON.stringify(latest.api)} SQL=${JSON.stringify(latest.sql)} 规则=${JSON.stringify(latest.ruleResults)}`
      : '无 API/DB 快照（未跑 checkpoint 或 L5 未配置查询）',
    '建议: 对照截图改 locatePrompt；若规则不一致则查接口/SQL 与屏上数字是否同一口径。',
  ]
    .filter(Boolean)
    .join('\n');

  const dir = join(process.cwd(), 'midscene_run', 'l5');
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${session.runId}-diagnose`);
  const payload = {
    kind: input.kind,
    title: input.title,
    error: input.error,
    screen,
    snapshot: latest ?? null,
    snapshots: store.snapshots,
    analysis,
    at: new Date().toISOString(),
    pageId: session.meta.id,
  };
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2), 'utf-8');
  writeFileSync(`${base}.md`, `# L5 诊断 ${session.runId}\n\n${analysis}\n`, 'utf-8');
  const rel = `midscene_run/l5/${session.runId}-diagnose.md`;
  console.log(`  L5 诊断已写入 ${rel}`);
  emitL5(session, {
    channel: 'diagnose',
    status: input.kind === 'rule-mismatch' || input.kind === 'step-fail' ? 'failed' : 'passed',
    name: `诊断 ${input.kind}`,
    detail: input.title,
    reportPath: rel,
  });
  return `${base}.md`;
}
