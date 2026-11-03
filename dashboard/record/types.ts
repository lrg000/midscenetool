/** 录制模式：浏览器 Playwright / 真机 Midscene 采集 */
export type RecordMode = 'browser' | 'device';

export type PackageKind = 'standalone' | 'loan-shell' | 'loan-postlogin';

export type RecordStepKind =
  | 'wait-page'
  | 'verify'
  | 'tap-text'
  | 'fill'
  | 'checkbox'
  | 'native-input'
  | 'action';

export interface RecordStep {
  kind: RecordStepKind;
  label: string;
  /** 可见文案 / 点击目标 */
  text?: string;
  /** 输入值 */
  value?: string;
  /** native-input: mobile | otp */
  valueKey?: 'mobile' | 'otp';
  /** type: action 时的 action 名 */
  action?: string;
  assertPrompt?: string;
  locatePrompt?: string;
  optional?: boolean;
  section?: string;
}

export interface RecordPage {
  /** → pages/{pageKey}.yaml */
  pageKey: string;
  title: string;
  steps: RecordStep[];
}

export interface RecordMeta {
  packageId: string;
  appLabel: string;
  androidPackage: string;
  kind: PackageKind;
  actionDomains: string[];
  description?: string;
  testMobile?: string;
  testOtp?: string;
  /** 浏览器起始 URL */
  startUrl?: string;
  /** 真机设备 udid */
  deviceId?: string;
  skipLaunch?: boolean;
}

export interface RecordTrace {
  sessionId: string;
  mode: RecordMode;
  createdAt: string;
  updatedAt: string;
  meta: RecordMeta;
  pages: RecordPage[];
  /** 当前正在编辑的 page 下标 */
  currentPageIndex: number;
  status: 'recording' | 'stopped';
}

export interface StartRecordRequest {
  mode: RecordMode;
  packageId: string;
  appLabel?: string;
  androidPackage?: string;
  kind?: PackageKind;
  actionDomains?: string[];
  description?: string;
  testMobile?: string;
  testOtp?: string;
  url?: string;
  deviceId?: string;
  skipLaunch?: boolean;
  /** 首个页面 key，默认 recorded */
  pageKey?: string;
  pageTitle?: string;
}

export interface AddStepRequest {
  kind: RecordStepKind;
  label?: string;
  text?: string;
  value?: string;
  valueKey?: 'mobile' | 'otp';
  action?: string;
  assertPrompt?: string;
  locatePrompt?: string;
  optional?: boolean;
  section?: string;
}

export interface NewPageRequest {
  pageKey: string;
  title?: string;
}

export interface GenerateRequest {
  sessionId?: string;
  overwrite?: boolean;
}

export interface GenerateResult {
  packageId: string;
  written: string[];
  skipped: string[];
  warnings: string[];
}
