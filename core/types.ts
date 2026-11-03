import type { AndroidAgent, AndroidDevice } from '@midscene/android';

export interface DropdownField {
  label: string;
  modalTitle: string;
  section?: string;
  /** 选中选项后需再点 Confirm 才关闭弹窗并回显（如 V2 Area/Locality） */
  requiresConfirm?: boolean;
}

export interface InputField {
  label: string;
  /**
   * 非法值（单值，兼容旧 YAML）。
   * 与 invalidValues 同时存在时合并去重，优先跑 invalidValues。
   */
  invalidValue?: string;
  /** 多组非法值；每项各跑一条「非法值失焦应提示错误」 */
  invalidValues?: string[];
  /**
   * 合法值（单值，兼容旧 YAML）。
   * 与 validValues 同时存在时合并去重；最后一项会留在输入框供后续步骤使用。
   */
  validValue?: string;
  /** 多组合法值；每项各跑一条「合法值失焦不应提示错误」 */
  validValues?: string[];
  skipInvalidBlurTest: boolean;
  /** 日期选择器等非文本输入，跳过全部失焦/空值/非法值用例 */
  skipInputTests?: boolean;
  /** A 面等：失焦不做必填空值校验（仅填合法值或跳过空值用例） */
  skipEmptyBlurTest?: boolean;
  /** 填合法值后不做「失焦不应报错」断言（键盘遮挡/误判红框时用） */
  skipValidBlurTest?: boolean;
  /** Bottom Sheet 内输入：禁止 scrollToElement（滑动会关闭弹层） */
  skipScrollBeforeInput?: boolean;
  /** 填完后不点页头失焦（失焦会关闭 Bottom Sheet） */
  skipBlurAfterInput?: boolean;
  /**
   * aiInput 后是否收起键盘。Bottom Sheet 底部 Save 被键盘挡住时设 true；
   * T42 弹层输入默认 false（BACK 可能关弹窗）。
   */
  autoDismissKeyboard?: boolean;
  section?: string;
  /** 覆盖默认定位语，避免误点相邻下拉/日期行 */
  locatePrompt?: string;
  /** 覆盖非法值失焦后的错误断言（如 IFSC 橙色放款警告不算红字） */
  invalidErrorPrompt?: string;
  /** 覆盖合法值失焦后的无错误断言（忽略相邻字段红字） */
  validAssertPrompt?: string;
}

export interface ContactField {
  section: string;
  label: string;
  placeholder: string;
  /** Full Name 同行下方 Mobile 行的灰色占位符 */
  mobilePlaceholder?: string;
  /**
   * 原生通讯录列表起始序号（0-based）。
   * 运行时会错开已用序号，并按回填 Full Name 去重（撞名则改选下一项）。
   */
  contactIndex: number;
}

/** Reference Contacts：声明 N 个联系人区块，加载时展开为 dropdowns/contacts/flow */
export interface ReferenceSectionSpec {
  section: string;
  /** 原生通讯录列表中的联系人序号（0-based）；默认用数组下标 */
  contactIndex?: number;
  /** 页面上可能没有该区块时跳过（如仅部分账号有第三人） */
  optional?: boolean;
}

export interface ReferenceDefaults {
  relationshipLabel?: string;
  relationshipModalTitle?: string;
  contactLabel?: string;
  placeholder?: string;
  mobilePlaceholder?: string;
}

export interface CheckboxField {
  label: string;
  section?: string;
  /** 覆盖默认勾选框定位语（如 T53 登录底栏，避免点到协议蓝链） */
  locatePrompt?: string;
  /** 覆盖「是否已勾选」布尔问句 */
  checkedPrompt?: string;
}

export type FlowStepType =
  | 'dropdown'
  | 'input'
  | 'native-input'
  | 'contact'
  | 'checkbox'
  | 'action'
  | 'verify'
  | 'checkpoint'
  | 'explore';

export interface FlowStep {
  section: string;
  type: FlowStepType;
  label: string;
  action?: string;
  assertPrompt?: string;
  /** native-input / 点击的精确定位语（覆盖默认 label） */
  locatePrompt?: string;
  manualWaitSec?: number;
  skip?: boolean;
  /** 目标不存在时跳过、不失败（如冷启协议弹窗可能已同意过） */
  optional?: boolean;
  /**
   * tap-text：为 true 时先失焦再滑动再点（底部主按钮/键盘场景）。
   * 默认 false：居中弹窗按钮（Agree & Continue）直接点，避免误滑误触。
   * 失败后仍会：收键盘 → 上下滑找 → 再失败（除非 noScrollRetry）。
   */
  scrollBeforeTap?: boolean;
  /**
   * tap-text：禁止失败后滑页重试（Y22 New Note Sheet 等，滑动会关弹层）。
   * 未设时：scrollBeforeTap===false 也视为禁止滑页重试以兼容旧 YAML。
   */
  noScrollRetry?: boolean;
  /** native-input：mobile | otp */
  valueKey?: 'mobile' | 'otp';
  /**
   * native-input：输入后自动收起键盘（全屏 Phone Code 页需要 true；
   * T42 Login with OTP 弹窗须保持 false，避免 BACK 关弹窗）。
   */
  autoDismissKeyboard?: boolean;
  /** verify 失败时重试次数（用于自动回填等有延迟的场景） */
  retry?: number;
  retryDelayMs?: number;
  /**
   * verify：校验前先向下滑动次数（适配小屏，底部文案需滑入视野）。
   * 也可配 locatePrompt：先 scrollToElement 再 aiAssert。
   */
  scrollDownBefore?: number;
  /** pick-native-contact / pick-gallery-image：列表序号（0-based，默认 0） */
  contactIndex?: number;
  /** fill-input：直接填入文本（不走 blur 测试套件）；配合 inputs[].label 定位 */
  inputValue?: string;
  /** fill-input：inputs 配置里的 label；未设时与 step.label 相同 */
  inputFieldLabel?: string;
  /**
   * L4/L5：type=checkpoint 时拉取 API/SQL、抽取 UI 并跑 rules。
   * 查询 id 定义在 config/l5.yaml。
   */
  observe?: {
    uiExtract?: Record<string, string>;
    apis?: string[];
    sqls?: string[];
    rules?: string[];
    optional?: boolean;
    waitForApply?: boolean;
    jsExtract?: boolean;
  };
}

export interface SubmitConfig {
  enabled: boolean;
  buttonPrompt: string;
  nextPageAssert: string;
  /** 提交前是否要求 Next 按钮可点击（Reference Contacts 等） */
  requireEnabled?: boolean;
  /**
   * 点击 Next 后若未离开当前页，额外重试点击次数（不含首次）。
   * 未配置时用 environment.yaml submit.retryTapIfStay（默认 2）。
   * 设为 0 可关闭该页兜底。
   */
  retryTapIfStay?: number;
  /** 每次重试前等待（ms）；未配置时用 environment / timing.afterSubmit */
  retryDelayMs?: number;
  /**
   * 判断「仍停在本页」的布尔问句；不配则用通用「标题页表单是否仍为主内容」。
   * Answer only true or false.
   */
  stayOnPagePrompt?: string;
}

/** 页面 UI 版本探测（如 Basic info V1 单页 / V2 三页） */
export interface VersionDetectConfig {
  enabled: boolean;
  /** true → 使用 versions.v2 */
  v2Prompt: string;
  /** v2Prompt 为 false 时的兜底（例如已停在 V2 地址页） */
  v2FallbackPrompt?: string;
}

export interface PageVariantConfig {
  flow: FlowStep[];
  submit: SubmitConfig;
  bottomFields?: string[];
}

export interface PageDataConfig {
  page: {
    id: string;
    title: string;
    route?: string;
    /** 原生 Android 页（非 H5 WebView 表单） */
    isNative?: boolean;
    skipNavigation: boolean;
    navigationPrompt: string;
    blurTarget: string;
    aiContext: string;
    bottomFields: string[];
    versionDetect?: VersionDetectConfig;
  };
  dropdowns: DropdownField[];
  inputs: InputField[];
  contacts?: ContactField[];
  checkboxes?: CheckboxField[];
  /**
   * 紧急联系人区块列表（2/3/N 个）。配置后自动展开 Relationship 下拉 + Full Name 通讯录步骤。
   * 再增加联系人只需往数组追加一项。
   */
  references?: ReferenceSectionSpec[];
  /** references 展开时的字段默认文案 */
  referenceDefaults?: ReferenceDefaults;
  /** 默认 flow（无 versions 或判定为 V1 时使用） */
  flow: FlowStep[];
  submit: SubmitConfig;
  /** 可选多版本；V2 等在 versionDetect 命中后替换 flow/submit */
  versions?: {
    v2?: PageVariantConfig;
  };
}

export interface PageMeta {
  id: string;
  title: string;
  dataFile: string;
  enabled: boolean;
  groupName: string;
  route?: string;
}

export interface EnvironmentConfig {
  agent: { replanningCycleLimit: number; generateReport: boolean };
  timing: Record<string, number>;
  scroll: {
    maxDown: number;
    maxUp: number;
    maxUpSequential: number;
    settleMs: number;
    sequentialDownFirst: boolean;
  };
  dropdown: {
    skipModalOpenAiCheck: boolean;
    maxSelectAttempts: number;
    randomOptionCount: number;
  };
  /**
   * 所有启用 submit 的页面默认行为；单页 YAML 的 submit.* 可覆盖。
   * retryTapIfStay：首次点 Next 后若仍在本页，额外重试次数。
   */
  submit?: {
    retryTapIfStay?: number;
    retryDelayMs?: number;
  };
  kyc?: {
    photoManualWaitSec: number;
    selfieCaptureWaitSec: number;
    /** 入口校验通过后，等待人工完成 Aadhaar OCR 的上限（秒） */
    ocrManualWaitSec?: number;
  };
  /** B 面全流程冷启启动的 App（applicationId） */
  app?: {
    androidPackage?: string;
  };
  paths: {
    midsceneRun: string;
    screenshots: string;
    cache: string;
    tmp: string;
    midsceneOutput: string;
    midsceneReport: string;
  };
  /**
   * 运行产物保留策略（仅 midscene_run，不影响业务 YAML）。
   * autoPruneOnStart：每次建 session 时按 retainDays 清理旧报告/截图/日志。
   */
  artifacts?: {
    retainDays?: number;
    autoPruneOnStart?: boolean;
    /** 每个目标目录额外只保留最新 N 个文件；不设则仅按天数 */
    keepLatestReports?: number;
    targets?: Array<'report' | 'screenshots' | 'log' | 'output' | 'tmp' | 'cache'>;
  };
}

export interface SelectedOption {
  index: number;
  optionText: string | null;
}

export interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  error?: string;
  skipReason?: string;
  timestamp: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
}

export interface AgentSession {
  agent: AndroidAgent;
  device: AndroidDevice;
  page: PageDataConfig;
  meta: PageMeta;
  env: EnvironmentConfig;
  runId: string;
  runStartedAt?: Date;
  reportFilePath: string | null;
  metrics?: import('./ai-metrics.js').AiMetrics;
  /** 自定义 prompt 级缓存（与 Midscene 定位缓存分目录，默认业务步骤可不使用） */
  cache?: import('./ai-cache.js').AiCache;
  accountProfile?: import('./account-profile.js').AccountProfile | null;
  /** 当前 A 面包（aside 运行时设置；B 面可为空） */
  packageProfile?: import('./package-profile.js').PackageProfile | null;
  /**
   * 允许的 action 域门禁；未设置则不校验。
   * A 面取自 package.actionDomains；B 面默认 common+loan。
   */
  allowedActionDomains?: import('./actions/domains.js').ActionDomain[] | null;
  /** L4/L5 三端快照与诊断 */
  l5?: import('./l5/types.js').L5Store;
}

export type PageState =
  | 'INIT'
  | 'CONNECTING'
  | 'PAGE_READY'
  | 'TESTING'
  | 'SUBMITTING'
  | 'FINISHED'
  | 'FAILED';

export interface StateMachineContext {
  session: AgentSession;
  currentState: PageState;
  flowIndex: number;
  currentSection: string;
}
