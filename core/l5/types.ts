import type { AgentSession } from '../types.js';

export interface L5HttpQuery {
  method?: string;
  /** 可含 {{mobile}} {{otp}} {{env:VAR}} */
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number;
  jsonPath?: string;
  /** 对 jsonPath 结果做聚合；`max` 用于 loanAmountList 默认展示最大额度 */
  jsonReduce?: 'max' | 'min' | 'first' | 'last';
}

export interface L5SqlQuery {
  database?: string;
  sql: string;
  params?: unknown[];
  column?: string;
  /** true：extracted 为全部行（紧急联系人列表）；默认仍取第一行 */
  extractAll?: boolean;
}

export interface L5Rule {
  description?: string;
  coerce?: 'string' | 'number' | 'contacts';
  tolerance?: number;
  compare: Array<{
    source: 'ui' | 'api' | 'sql';
    key?: string;
    query?: string;
    jsonPath?: string;
    column?: string;
  }>;
}

export interface L5Database {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface L5Config {
  enabled?: boolean;
  http?: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  };
  databases?: Record<string, L5Database>;
  apis?: Record<string, L5HttpQuery>;
  sqls?: Record<string, L5SqlQuery>;
  rules?: Record<string, L5Rule>;
  explore?: {
    enabled?: boolean;
    packageId?: string;
    maxSteps?: number;
    stopPrompt?: string;
    denyTap?: string[];
    checkpoints?: Array<{
      label: string;
      apis?: string[];
      sqls?: string[];
      rules?: string[];
      uiExtract?: Record<string, string>;
      optional?: boolean;
    }>;
  };
  diagnose?: {
    enabled?: boolean;
  };
  /**
   * 首页分流检测到 Apply 主按钮时、点击之前跑额度三端核对。
   * H5 localStorage 在识别到 Next/Apply/Go to repay 时就会抽，不绑在 Apply 上。
   * 不要配在 apply-success 点完 Apply 之后。
   */
  beforeApply?: ObserveSpec & { enabled?: boolean; label?: string };
  /**
   * 紧急联系人点 Next 离开后再核对：屏上名单（提交前抽取）= customer_contact。
   * 不调用 saveLianXiRenList。库表会多一行 relation=0、号码=登录手机号。
   */
  afterEmergencyContacts?: ObserveSpec & { enabled?: boolean; label?: string };
}

export interface ObserveSpec {
  uiExtract?: Record<string, string>;
  /** 提交前已抽好的 UI，提交后核对不再识图 */
  uiPrefill?: Record<string, unknown>;
  apis?: string[];
  sqls?: string[];
  rules?: string[];
  optional?: boolean;
  /** 先等到 H5 Apply 可见再抽数（不点击 Apply） */
  waitForApply?: boolean;
  /** 用 WebView JS 取 APP_AUTH_TOKEN / USER_CODE / MARKET_ID（APP_CODE 同 MARKET_ID），默认 true */
  jsExtract?: boolean;
}

export interface L5Snapshot {
  at: string;
  ui?: Record<string, unknown>;
  api?: Record<string, { status?: number; json?: unknown; extracted?: unknown; error?: string }>;
  sql?: Record<string, { rows?: unknown; extracted?: unknown; error?: string }>;
  ruleResults?: Array<{ id: string; ok: boolean; message: string; values?: unknown[] }>;
}

export interface L5Store {
  snapshots: L5Snapshot[];
  lastError?: string;
  /** H5 JS 抽出的会话参数，插值优先于 process.env */
  runtimeVars?: Record<string, string>;
}

export function emptyL5Store(): L5Store {
  return { snapshots: [] };
}

export function getL5Store(session: AgentSession): L5Store {
  if (!session.l5) session.l5 = emptyL5Store();
  return session.l5;
}
