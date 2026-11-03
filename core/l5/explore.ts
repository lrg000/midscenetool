import type { AgentSession } from '../types.js';
import { recordPassed, recordSkipped } from '../test-context.js';
import { loadL5Config } from './config.js';
import { writeL5Diagnosis } from './diagnose.js';
import { runObserve } from './observe.js';

function parseTapList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[,，;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function runL3Explore(session: AgentSession): Promise<void> {
  const cfg = loadL5Config();
  const explore = cfg.explore;
  if (explore?.enabled === false) {
    recordSkipped('L3 探索', 'config/l5.yaml explore.enabled=false');
    return;
  }
  const maxSteps = explore?.maxSteps ?? 6;
  const deny = (explore?.denyTap ?? ['Decline', 'Delete', 'Uninstall', 'Logout', '拒绝']).map(
    (s) => s.toLowerCase(),
  );
  const stopPrompt =
    explore?.stopPrompt ??
    'Is a blocking system permission dialog or a crash / ANR / force-close visible? Answer only true or false.';

  console.log(`\n========== L3 探索（最多 ${maxSteps} 步） ==========`);

  for (let i = 0; i < maxSteps; i++) {
    const blocked = await session.agent.aiBoolean(stopPrompt);
    if (blocked) {
      recordSkipped(`L3 探索停止@${i + 1}`, '命中 stopPrompt');
      break;
    }

    const taps = parseTapList(
      await session.agent.aiQuery(
        'List 3 visible tappable button or link texts on this screen, comma-separated, ' +
          'prefer primary actions. Exclude navigation that leaves the app. No explanation.',
      ),
    );
    const choice = taps.find((t) => !deny.some((d) => t.toLowerCase().includes(d)));
    if (!choice) {
      recordSkipped(`L3 探索@${i + 1}`, '无可点目标');
      break;
    }

    await session.agent.aiTap(`The visible control with text "${choice}"`);
    recordPassed(`L3 探索点击: ${choice}`);

    for (const cp of explore?.checkpoints ?? []) {
      await runObserve(
        session,
        {
          uiExtract: cp.uiExtract,
          apis: cp.apis,
          sqls: cp.sqls,
          rules: cp.rules,
          optional: cp.optional ?? true,
        },
        `L3/${cp.label}`,
      );
    }
  }

  await writeL5Diagnosis(session, {
    kind: 'explore',
    title: 'L3 探索结束',
  });
}
