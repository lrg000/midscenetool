import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  GenerateResult,
  RecordPage,
  RecordStep,
  RecordTrace,
} from './types.js';
import { loadTraceFromDisk, resolveActive } from './session-store.js';

const ROOT = process.cwd();

function flowStepFromRecord(step: RecordStep): Record<string, unknown> {
  const base: Record<string, unknown> = {
    section: step.section || 'Recorded',
    label: step.label,
  };
  if (step.optional) base.optional = true;

  switch (step.kind) {
    case 'verify':
      return {
        ...base,
        type: 'verify',
        assertPrompt:
          step.assertPrompt ||
          (step.text
            ? `The screen shows "${step.text}". Answer only true or false.`
            : 'The expected screen content is visible. Answer only true or false.'),
      };
    case 'wait-page':
      return {
        ...base,
        type: 'action',
        action: 'wait-page',
        assertPrompt:
          step.assertPrompt ||
          (step.text
            ? `Is the screen showing content related to "${step.text}"? Answer only true or false.`
            : 'Has the target screen finished loading? Answer only true or false.'),
      };
    case 'tap-text':
      return {
        ...base,
        type: 'action',
        action: 'tap-text',
        assertPrompt: step.assertPrompt || step.text || step.label,
        locatePrompt:
          step.locatePrompt ||
          (step.text ? `The visible text/control "${step.text}"` : step.label),
      };
    case 'checkbox':
      return {
        ...base,
        type: 'checkbox',
        label: step.text || step.label,
      };
    case 'native-input':
      return {
        ...base,
        type: 'native-input',
        label: step.text || step.label,
        valueKey: step.valueKey || 'mobile',
      };
    case 'fill': {
      if (step.valueKey === 'mobile' || step.valueKey === 'otp') {
        return {
          ...base,
          type: 'native-input',
          label: step.text || step.label,
          valueKey: step.valueKey,
        };
      }
      return {
        ...base,
        type: 'action',
        action: 'fill-input',
        inputFieldLabel: step.text || step.label,
        inputValue: step.value ?? '',
        locatePrompt:
          step.locatePrompt ||
          (step.text ? `The input field "${step.text}"` : undefined),
      };
    }
    case 'action':
      return {
        ...base,
        type: 'action',
        action: step.action || 'tap-text',
        assertPrompt: step.assertPrompt,
        locatePrompt: step.locatePrompt,
      };
    default:
      return {
        ...base,
        type: 'action',
        action: 'tap-text',
        optional: true,
        locatePrompt: step.locatePrompt || step.label,
        assertPrompt: step.assertPrompt || step.label,
      };
  }
}

function collectCheckboxes(steps: RecordStep[]): Array<{ label: string }> {
  const labels = new Set<string>();
  for (const s of steps) {
    if (s.kind === 'checkbox') {
      const label = (s.text || s.label).trim();
      if (label) labels.add(label);
    }
  }
  return [...labels].map((label) => ({ label }));
}

function pageYamlContent(trace: RecordTrace, page: RecordPage): string {
  const packageId = trace.meta.packageId;
  const pageId = `aside-${packageId}-${page.pageKey}`;
  const checkboxes = collectCheckboxes(page.steps);
  const flow = page.steps.map(flowStepFromRecord);

  const doc: Record<string, unknown> = {
    page: {
      id: pageId,
      title: page.title || page.pageKey,
      isNative: true,
      skipNavigation: true,
      navigationPrompt: '',
      blurTarget: `the title ${page.title || page.pageKey}`,
      aiContext: [
        `${trace.meta.appLabel} A-side page (recorded).`,
        `packageId=${packageId} androidPackage=${trace.meta.androidPackage || 'n/a'}.`,
        'Generated from Dashboard record session; refine prompts against PRD / real UI.',
      ].join(' '),
      bottomFields: [],
    },
    dropdowns: [],
    inputs: [],
    ...(checkboxes.length ? { checkboxes } : {}),
    flow,
    submit: { enabled: false },
  };

  const header = [
    `# Auto-generated from Dashboard record session ${trace.sessionId}`,
    `# mode=${trace.mode} package=${packageId} page=${page.pageKey}`,
    `# Refine locatePrompt / assertPrompt against PRD before relying on CI.`,
    '',
  ].join('\n');

  return header + stringifyYaml(doc, { lineWidth: 100 });
}

function testTsContent(trace: RecordTrace): string {
  const id = trace.meta.packageId;
  const lines: string[] = [
    `import 'dotenv/config';`,
    `import { runAsidePackage } from '../../core/aside-runner.js';`,
    ``,
    `/**`,
    ` * ${trace.meta.appLabel} A 面（Dashboard 录制生成）`,
    ` * session: ${trace.sessionId}`,
    ` *`,
    ` *   npm run test:aside:${id}`,
    ` */`,
  ];
  if (trace.meta.testMobile) {
    lines.push(`process.env.TEST_MOBILE = '${trace.meta.testMobile}';`);
  }
  if (trace.meta.testOtp) {
    lines.push(`process.env.TEST_OTP = '${trace.meta.testOtp}';`);
  }
  lines.push(
    ``,
    `Promise.resolve(`,
    `  runAsidePackage('${id}', {`,
    `    skipLaunch: process.env.ASIDE_SKIP_LAUNCH === '1',`,
    `    runHandoff: process.env.ASIDE_RUN_HANDOFF === '1',`,
    `  }).catch((err) => {`,
    `    console.error('\\nA 面测试异常:', err instanceof Error ? err.message : String(err));`,
    `    process.exitCode = 1;`,
    `  }),`,
    `);`,
    ``,
  );
  return lines.join('\n');
}

function readmeContent(trace: RecordTrace): string {
  return [
    `# ${trace.meta.appLabel} (\`${trace.meta.packageId}\`)`,
    ``,
    `- kind: ${trace.meta.kind}`,
    `- androidPackage: \`${trace.meta.androidPackage || '（未填）'}\``,
    `- 来源: Dashboard 录制（${trace.mode}） session \`${trace.sessionId}\``,
    `- 执行: \`npm run test:aside:${trace.meta.packageId}\``,
    ``,
    `生成后请对照 PRD / 实机截图精修 YAML 中的 locatePrompt 与 assertPrompt。`,
    ``,
  ].join('\n');
}

function nlCaseContent(trace: RecordTrace): string {
  const lines = [
    `# ${trace.meta.packageId} — 录制用例摘要（recorded）`,
    `# session: ${trace.sessionId}`,
    `# mode: ${trace.mode}`,
    ``,
    `## 包元信息`,
    ``,
    `| 字段 | 值 |`,
    `|------|-----|`,
    `| packageId | ${trace.meta.packageId} |`,
    `| appLabel | ${trace.meta.appLabel} |`,
    `| androidPackage | ${trace.meta.androidPackage || ''} |`,
    `| kind | ${trace.meta.kind} |`,
    ``,
    `## 步骤`,
    ``,
  ];
  for (const page of trace.pages) {
    lines.push(`### ${page.pageKey} — ${page.title}`);
    page.steps.forEach((s, i) => {
      lines.push(`${i + 1}. [${s.kind}] ${s.label}${s.text ? ` («${s.text}»)` : ''}`);
    });
    lines.push('');
  }
  lines.push(`## 生成产物`);
  lines.push(`- packages/${trace.meta.packageId}/pages/*.yaml`);
  lines.push(`- tests/aside/${trace.meta.packageId}.test.ts`);
  lines.push('');
  return lines.join('\n');
}

function pageRefLines(refs: Array<{ id: string; dataFile: string }>): string {
  return refs
    .map((r) => `      - id: ${r.id}\n        dataFile: ${r.dataFile}`)
    .join('\n');
}

function mergePackagesYaml(trace: RecordTrace, writtenPageFiles: string[]): string[] {
  const warnings: string[] = [];
  const packagesPath = join(ROOT, 'config', 'packages.yaml');
  let raw = readFileSync(packagesPath, 'utf-8');
  const doc = parseYaml(raw) as {
    packages?: Record<string, { pages?: Array<{ id: string; dataFile: string }> }>;
  };

  const id = trace.meta.packageId;
  const pageRefs = writtenPageFiles.map((rel) => {
    const dataFile = rel.replace(`packages/${id}/`, '').replace(/\\/g, '/');
    const pageKey = dataFile.replace(/^pages\//, '').replace(/\.yaml$/, '');
    return { id: `aside-${id}-${pageKey}`, dataFile };
  });

  const existing = doc.packages?.[id];
  if (!existing) {
    const block = [
      ``,
      `  ${id}:`,
      `    name: ${id}.${trace.meta.appLabel}`,
      `    description: |`,
      `      Dashboard 录制生成（${trace.mode} session ${trace.sessionId}）`,
      `    kind: ${trace.meta.kind}`,
      `    actionDomains:`,
      ...trace.meta.actionDomains.map((d) => `      - ${d}`),
      `    appLabel: ${trace.meta.appLabel}`,
      ...(trace.meta.androidPackage
        ? [`    androidPackage: ${trace.meta.androidPackage}`]
        : []),
      `    pages:`,
      pageRefLines(pageRefs),
      ``,
    ].join('\n');
    raw = raw.replace(/\s*$/, '') + '\n' + block;
    writeFileSync(packagesPath, raw, 'utf-8');
    return warnings;
  }

  const known = new Set(
    (existing.pages ?? []).flatMap((p) => [p.id, p.dataFile]),
  );
  const toAdd = pageRefs.filter((r) => !known.has(r.id) && !known.has(r.dataFile));
  for (const r of pageRefs) {
    if (known.has(r.id) || known.has(r.dataFile)) {
      warnings.push(`packages.yaml 已有页面 ${r.dataFile}，跳过注册重复项`);
    }
  }
  if (!toAdd.length) return warnings;

  // 在该包 pages: 列表末尾追加（匹配缩进 6 空格的 - id:）
  const pkgHeader = new RegExp(`(^|\\n)(  ${id}:\\n[\\s\\S]*?    pages:\\n)`, 'm');
  const m = raw.match(pkgHeader);
  if (!m) {
    warnings.push('未能定位 packages.yaml 中的 pages 列表，请手动注册');
    return warnings;
  }

  // 找到该包下一个顶层 key 或文件结尾
  const startIdx = m.index! + m[0].length;
  const rest = raw.slice(startIdx);
  const nextPkg = rest.search(/\n  [a-zA-Z0-9_-]+:/);
  const pagesBlockEnd = nextPkg >= 0 ? startIdx + nextPkg : raw.length;
  const insert = (raw.slice(startIdx, pagesBlockEnd).endsWith('\n') ? '' : '\n') + pageRefLines(toAdd) + '\n';
  raw = raw.slice(0, pagesBlockEnd) + insert + raw.slice(pagesBlockEnd);
  writeFileSync(packagesPath, raw, 'utf-8');
  return warnings;
}

function ensurePackageJsonScript(packageId: string): { written: boolean; path: string } {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts) pkg.scripts = {};
  const key = `test:aside:${packageId}`;
  if (pkg.scripts[key]) {
    return { written: false, path: 'package.json' };
  }
  pkg.scripts[key] = `tsx tests/aside/${packageId}.test.ts`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
  return { written: true, path: 'package.json' };
}

export function generateAsideFromTrace(
  sessionId: string | undefined,
  overwrite = false,
): GenerateResult {
  const trace: RecordTrace = sessionId
    ? resolveActive(sessionId)
    : resolveActive();
  // prefer disk copy for latest
  const disk = loadTraceFromDisk(trace.sessionId);
  const src = disk ?? trace;

  if (!src.pages.length) {
    throw new Error('轨迹中没有页面，无法生成');
  }
  const totalSteps = src.pages.reduce((n, p) => n + p.steps.length, 0);
  if (totalSteps === 0) {
    throw new Error('轨迹中没有步骤，请先录制或手动添加步骤');
  }

  const packageId = src.meta.packageId;
  const pkgDir = join(ROOT, 'packages', packageId);
  const pagesDir = join(pkgDir, 'pages');
  const casesDir = join(pkgDir, 'cases');
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(casesDir, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const writtenPageRels: string[] = [];

  for (const page of src.pages) {
    if (!page.steps.length) {
      warnings.push(`页面 ${page.pageKey} 无步骤，已跳过`);
      continue;
    }
    const rel = `packages/${packageId}/pages/${page.pageKey}.yaml`;
    const abs = join(ROOT, rel);
    if (existsSync(abs) && !overwrite) {
      skipped.push(rel);
      warnings.push(`已存在 ${rel}（未勾选覆盖）`);
      continue;
    }
    writeFileSync(abs, pageYamlContent(src, page), 'utf-8');
    written.push(rel);
    writtenPageRels.push(rel);
  }

  if (!writtenPageRels.length && skipped.length) {
    throw new Error(
      `没有写入任何 YAML。已存在: ${skipped.join(', ')}。请勾选 overwrite 或换 packageId/pageKey。`,
    );
  }

  const readmeRel = `packages/${packageId}/README.md`;
  const readmeAbs = join(ROOT, readmeRel);
  if (!existsSync(readmeAbs) || overwrite) {
    writeFileSync(readmeAbs, readmeContent(src), 'utf-8');
    written.push(readmeRel);
  }

  const nlRel = `packages/${packageId}/cases/${packageId}-recorded.nl.txt`;
  writeFileSync(join(ROOT, nlRel), nlCaseContent(src), 'utf-8');
  written.push(nlRel);

  const tsRel = `tests/aside/${packageId}.test.ts`;
  const tsAbs = join(ROOT, tsRel);
  if (existsSync(tsAbs) && !overwrite) {
    skipped.push(tsRel);
    warnings.push(`已存在 ${tsRel}（未勾选覆盖）`);
  } else {
    mkdirSync(join(ROOT, 'tests', 'aside'), { recursive: true });
    writeFileSync(tsAbs, testTsContent(src), 'utf-8');
    written.push(tsRel);
  }

  // 注册：即使部分 yaml 因 overwrite=false 跳过，也要把本次写入的页 append 进去
  const pagesForReg =
    writtenPageRels.length > 0
      ? writtenPageRels
      : src.pages
          .filter((p) => p.steps.length)
          .map((p) => `packages/${packageId}/pages/${p.pageKey}.yaml`);
  warnings.push(...mergePackagesYaml(src, pagesForReg));
  written.push('config/packages.yaml');

  const script = ensurePackageJsonScript(packageId);
  if (script.written) written.push('package.json');
  else skipped.push('package.json (script exists)');

  return { packageId, written, skipped, warnings };
}
