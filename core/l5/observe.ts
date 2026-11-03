import type { AgentSession } from '../types.js';
import { recordFailed, recordPassed, recordSkipped } from '../test-context.js';
import { getL5RuntimeEnv, isL5Enabled, loadL5Config, setL5RuntimeEnv, valuesAligned } from './config.js';
import { sleep } from '../utils.js';
import { runHttpQuery } from './http-client.js';
import { runSqlQuery } from './mysql-client.js';
import { getL5Store, type ObserveSpec, type L5Snapshot } from './types.js';
import { writeL5Diagnosis } from './diagnose.js';
import { emitL5 } from './emit.js';
import { extractH5SessionVars, waitForH5ApplyButton } from './webview-js.js';

async function extractUi(
  session: AgentSession,
  prompts: Record<string, string>,
): Promise<Record<string, unknown>> {
  const ui: Record<string, unknown> = {};
  for (const [key, prompt] of Object.entries(prompts)) {
    try {
      ui[key] = await session.agent.aiQuery(
        `${prompt} Reply with the extracted value only, no explanation.`,
      );
    } catch (err) {
      ui[key] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return ui;
}

const DEFAULT_BEFORE_APPLY_UI = `
On the H5 loan home card, the currently displayed default maximum Amount
as digits only (e.g. 5000 from ₹ 5000). Slider max / default selected, not the min.
Apply is still visible. No currency symbol.`.trim();

/**
 * 登录后首页已见 Next / Apply / Go to repay 时立刻抽 H5 localStorage，
 * 写入 L5 runtime（{{env:APP_AUTH_TOKEN}} 等），不依赖 Apply、不做额度三端核对。
 */
export async function syncH5SessionVars(
  session: AgentSession,
  reason = '登录后首页',
): Promise<Record<string, string>> {
  console.log(`  L5 JS：${reason}，抽取 H5 localStorage...`);
  const vars = await extractH5SessionVars(session);
  setL5RuntimeEnv(vars);
  return vars;
}

/** 首页分流检测到 Apply 之后、点击之前（额度三端；JS 可跳过以免与 syncH5SessionVars 重复） */
export async function runBeforeApplyCheckpoint(
  session: AgentSession,
  opts?: { skipJsExtract?: boolean },
): Promise<void> {
  if (!isL5Enabled()) {
    recordSkipped('申请前额度三端一致', 'config/l5.yaml 未启用');
    return;
  }
  const hook = loadL5Config().beforeApply;
  if (hook?.enabled === false) {
    recordSkipped('申请前额度三端一致', 'beforeApply.enabled=false');
    return;
  }
  const spec: ObserveSpec = {
    optional: hook?.optional !== false,
    waitForApply: false,
    jsExtract: opts?.skipJsExtract ? false : hook?.jsExtract !== false,
    uiExtract: hook?.uiExtract ?? { creditLimit: DEFAULT_BEFORE_APPLY_UI },
    apis: hook?.apis ?? ['product-list-merge'],
    sqls: hook?.sqls ?? ['credit-by-mobile-market'],
    rules: hook?.rules ?? ['credit-match'],
  };
  const label = hook?.label ?? '申请前额度三端一致';
  console.log(`  L4 申请前核对（Apply 主按钮已看见、尚未点击）...`);
  await runObserve(session, spec, label);
}

const DEFAULT_CONTACTS_UI = `
On the Reference Contacts form, extract every filled reference (Primary, Secondary, Third, ...)
as a JSON array. Each item:
{"relationName":"husband/wife","contactName":"A空格","contactPhone":"9928917181"}
Use the visible Relationship / Full Name / Mobile values. Phone digits only, no spaces.
Do not include empty sections. Reply with the JSON array only, no markdown.
`.trim();

export async function captureEmergencyContactsUi(
  session: AgentSession,
): Promise<Record<string, unknown>> {
  const prompt =
    loadL5Config().afterEmergencyContacts?.uiExtract?.emergencyContacts ?? DEFAULT_CONTACTS_UI;
  return extractUi(session, { emergencyContacts: prompt });
}

/** 紧急联系人 Next 成功离开后再对 屏上名单 / 查询接口 / customer_contact */
export async function runAfterEmergencyContactsCheckpoint(
  session: AgentSession,
  uiPrefill: Record<string, unknown>,
): Promise<void> {
  if (!isL5Enabled()) {
    recordSkipped('紧急联系人 UI/库一致', 'config/l5.yaml 未启用');
    return;
  }
  const hook = loadL5Config().afterEmergencyContacts;
  if (hook?.enabled === false) {
    recordSkipped('紧急联系人 UI/库一致', 'afterEmergencyContacts.enabled=false');
    return;
  }
  const spec: ObserveSpec = {
    optional: hook?.optional !== false,
    jsExtract: hook?.jsExtract === true,
    uiPrefill,
    apis: hook?.apis ?? [],
    sqls: hook?.sqls ?? ['contacts-by-customer'],
    rules: hook?.rules ?? ['emergency-contacts-match'],
  };
  const label = hook?.label ?? '紧急联系人 UI/库一致';
  console.log('  L4 紧急联系人核对（已离开本页，比对提交前 UI / 库表）...');
  await sleep(1500);
  await runObserve(session, spec, label);
}

export async function runObserve(
  session: AgentSession,
  spec: ObserveSpec,
  label: string,
): Promise<L5Snapshot> {
  const cfg = loadL5Config();
  const optional = spec.optional === true;

  if (spec.waitForApply) {
    const ready = await waitForH5ApplyButton(session, {
      maxAttempts: 12,
      optional,
    });
    if (!ready) {
      recordSkipped(`${label}`, '未检测到 H5 Apply，申请前核对未执行');
      const skipped: L5Snapshot = {
        at: new Date().toISOString(),
        ui: {},
        api: {},
        sql: {},
        ruleResults: [],
      };
      getL5Store(session).snapshots.push(skipped);
      return skipped;
    }
  }

  if (spec.jsExtract !== false) {
    const vars = await extractH5SessionVars(session);
    setL5RuntimeEnv(vars);
  }

  const snapshot: L5Snapshot = {
    at: new Date().toISOString(),
    ui: {},
    api: {},
    sql: {},
    ruleResults: [],
  };

  if (spec.uiPrefill && Object.keys(spec.uiPrefill).length) {
    snapshot.ui = spec.uiPrefill;
    console.log(`  UI 预填 ${JSON.stringify(snapshot.ui)}`);
    emitL5(session, {
      channel: 'ui',
      status: 'passed',
      name: `${label} / UI 预填`,
      detail: JSON.stringify(snapshot.ui),
    });
  } else if (spec.uiExtract && Object.keys(spec.uiExtract).length) {
    snapshot.ui = await extractUi(session, spec.uiExtract);
    console.log(`  UI 抽取 ${JSON.stringify(snapshot.ui)}`);
    emitL5(session, {
      channel: 'ui',
      status: 'passed',
      name: `${label} / UI 抽取`,
      detail: JSON.stringify(snapshot.ui),
    });
  }

  for (const id of spec.apis ?? []) {
    const result = await runHttpQuery(id, session.accountProfile);
    snapshot.api![id] = result;
    if (result.error && !optional) {
      recordFailed(`${label} / API ${id}`, result.error);
      emitL5(session, { channel: 'api', status: 'failed', name: `API ${id}`, detail: result.error });
    } else if (!result.error) {
      recordPassed(`${label} / API ${id}`);
      console.log(`  API ${id} extracted=${JSON.stringify(result.extracted)}`);
      emitL5(session, {
        channel: 'api',
        status: 'passed',
        name: `API ${id}`,
        detail: `HTTP ${result.status} extracted=${JSON.stringify(result.extracted)}`,
      });
    } else {
      recordSkipped(`${label} / API ${id}`, result.error);
      emitL5(session, { channel: 'api', status: 'skipped', name: `API ${id}`, detail: result.error });
    }
  }

  for (const id of spec.sqls ?? []) {
    const result = await runSqlQuery(id, session.accountProfile);
    snapshot.sql![id] = result;
    if (result.error && !optional) {
      recordFailed(`${label} / SQL ${id}`, result.error);
      emitL5(session, { channel: 'sql', status: 'failed', name: `SQL ${id}`, detail: result.error });
    } else if (!result.error) {
      recordPassed(`${label} / SQL ${id}`);
      console.log(`  SQL ${id} extracted=${JSON.stringify(result.extracted)}`);
      emitL5(session, {
        channel: 'sql',
        status: 'passed',
        name: `SQL ${id}`,
        detail: `extracted=${JSON.stringify(result.extracted)}`,
      });
    } else {
      recordSkipped(`${label} / SQL ${id}`, result.error);
      emitL5(session, { channel: 'sql', status: 'skipped', name: `SQL ${id}`, detail: result.error });
    }
  }

  for (const ruleId of spec.rules ?? []) {
    const rule = cfg.rules?.[ruleId];
    if (!rule) {
      const msg = `未配置 rules.${ruleId}`;
      snapshot.ruleResults!.push({ id: ruleId, ok: false, message: msg });
      if (!optional) {
        recordFailed(`${label} / 规则 ${ruleId}`, msg);
        emitL5(session, { channel: 'rule', status: 'failed', name: `规则 ${ruleId}`, detail: msg });
      } else {
        recordSkipped(`${label} / 规则 ${ruleId}`, msg);
        emitL5(session, { channel: 'rule', status: 'skipped', name: `规则 ${ruleId}`, detail: msg });
      }
      continue;
    }
    const values: unknown[] = [];
    const labeled: string[] = [];
    for (const side of rule.compare) {
      let v: unknown;
      let name: string;
      if (side.source === 'ui') {
        v = snapshot.ui?.[side.key ?? ''] ?? snapshot.ui;
        name = `UI ${side.key ?? ''}`.trim();
      } else if (side.source === 'api') {
        const qid = side.query ?? '';
        v = snapshot.api?.[qid]?.extracted;
        name = `API ${qid}`;
      } else {
        const qid = side.query ?? '';
        v = snapshot.sql?.[qid]?.extracted;
        name = `SQL ${qid}`;
      }
      values.push(v);
      labeled.push(`  ${name}: ${JSON.stringify(v)}`);
    }
    console.log(`  ---------- 三端取值（${ruleId}） ----------`);
    for (const line of labeled) console.log(line);
    const missing = values.some((v) => isMissingValue(v));
    if (missing && optional) {
      snapshot.ruleResults!.push({ id: ruleId, ok: true, message: '数据源缺失，optional 跳过', values });
      recordSkipped(`${label} / 规则 ${ruleId}`, 'API/SQL/UI 未取到值（optional）');
      emitL5(session, {
        channel: 'rule',
        status: 'skipped',
        name: `规则 ${ruleId}`,
        detail: 'API/SQL/UI 未取到值（optional）',
      });
      continue;
    }
    const ok =
      !missing &&
      valuesAligned(values, rule.coerce, rule.tolerance ?? 0, {
        loginPhone: getL5RuntimeEnv().PHONE ?? '',
      });
    const message = ok
      ? (rule.description ?? '三端一致')
      : `${rule.description ?? ruleId} 不一致: ${JSON.stringify(values)}`;
    snapshot.ruleResults!.push({ id: ruleId, ok, message, values });
    if (ok) {
      recordPassed(`${label} / 规则 ${ruleId}`);
      emitL5(session, {
        channel: 'rule',
        status: 'passed',
        name: `规则 ${ruleId}`,
        detail: `${message} | ${labeled.map((l) => l.trim()).join(' ; ')}`,
      });
    } else if (optional) {
      recordSkipped(`${label} / 规则 ${ruleId}`, message);
      emitL5(session, { channel: 'rule', status: 'skipped', name: `规则 ${ruleId}`, detail: message });
    } else {
      recordFailed(`${label} / 规则 ${ruleId}`, message);
      emitL5(session, { channel: 'rule', status: 'failed', name: `规则 ${ruleId}`, detail: message });
      await writeL5Diagnosis(session, {
        kind: 'rule-mismatch',
        title: message,
        snapshot,
      });
    }
  }

  getL5Store(session).snapshots.push(snapshot);

  const hardFail = snapshot.ruleResults?.some((r) => !r.ok) && !optional;
  const apiFail = Object.values(snapshot.api ?? {}).some((a) => a.error) && !optional;
  const sqlFail = Object.values(snapshot.sql ?? {}).some((s) => s.error) && !optional;
  if (hardFail || apiFail || sqlFail) {
    throw new Error(`L4 核对失败: ${label}`);
  }
  return snapshot;
}

function isMissingValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'object' && v && 'error' in (v as object)) return true;
  if (Array.isArray(v)) {
    if (v.length === 0) return true;
    const first = v[0];
    if (
      first &&
      typeof first === 'object' &&
      'credit_limit' in first &&
      (first as { credit_limit: unknown }).credit_limit == null &&
      !('contact_phone' in first) &&
      !('contactPhone' in first)
    ) {
      return true;
    }
  }
  return false;
}
