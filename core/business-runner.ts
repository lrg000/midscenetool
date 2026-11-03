import { loadFlowConfig, loadFlowPageIds } from './config-loader.js';
import { createAgentSession, connectSession } from './ai-agent.js';
import { switchPageSession } from './credentials.js';
import {
  detectHomeState,
  HOME_FLOW_MAP,
  tapHomeButton,
  type HomeState,
} from './home-router.js';
import { executePageFlow } from './page-executor.js';
import { runKycFlexibleCluster, splitKycFlexibleSegments } from './kyc-router.js';
import { clearResults } from './test-context.js';
import type { AgentSession } from './types.js';
import { resolveAccountProfile, type AccountProfile } from './account-profile.js';
import { launchAndroidApp, resolveBusinessAndroidPackage } from './app-launch.js';
import { B_SIDE_ACTION_DOMAINS } from './actions/domains.js';
import {
  assertSharedPreloginExists,
  resolvePreloginSource,
  switchSessionToPackagePage,
} from './package-prelogin.js';

export type RunMode = 'single-page' | 'segment' | 'full-flow';

export interface BusinessFlowOptions {
  runId?: string;
  /** 账号配置名，见 config/accounts.yaml */
  accountProfile?: string;
  /** 跳过 bootstrap（登录前操作） */
  skipBootstrap?: boolean;
  /** 跳过登录（设备已登录且已在 H5） */
  skipLogin?: boolean;
  /** 强制首页分流按钮，跳过 AI 检测 */
  homeState?: HomeState;
  /** 从 pages 数组第几项开始（0-based） */
  startPageIndex?: number;
  /** 指定 Android 设备 udid（多设备并行时传入） */
  deviceId?: string;
  /** 跳过按包名 launch（假定 App 已在前台） */
  skipLaunch?: boolean;
  /** 覆盖 environment.yaml / flow 的 Android applicationId */
  androidPackage?: string;
  /** 覆盖账号配置里的登录手机号 */
  mobile?: string;
  /** 覆盖账号配置里的 OTP */
  otp?: string;
}

function resolveRunMode(flowId: string, opts: BusinessFlowOptions): RunMode {
  if (opts.skipLogin && (opts.startPageIndex ?? 0) > 0) return 'single-page';
  // business-auto 的 pages 只有 login 占位，必须在 pages.length 判断之前归为全流程，
  // 否则会被误判为 single-page，跳过首页 Next/Apply/Go to repay 分流。
  if (flowId === 'business-auto' || flowId.startsWith('business-')) return 'full-flow';
  const pages = loadFlowPageIds(flowId);
  if (pages.length === 1) return 'single-page';
  if (pages.length <= 2) return 'segment';
  return 'full-flow';
}

async function runBootstrapIfNeeded(
  session: AgentSession,
  flowId: string,
  skipBootstrap?: boolean,
  androidPackage?: string,
): Promise<void> {
  if (skipBootstrap) {
    console.log('  ⏭️ 跳过 bootstrap（skipBootstrap）');
    return;
  }
  const flow = loadFlowConfig(flowId);
  const bootstrapId = flow.bootstrap === undefined ? 'app-bootstrap' : flow.bootstrap;
  if (!bootstrapId) return;

  console.log('\n========== 阶段 0: Bootstrap（登录前） ==========');
  const resolved = resolvePreloginSource(androidPackage, 'bootstrap');
  if (resolved.mode === 'package' && resolved.packageProfile && resolved.pageRef) {
    console.log(
      `  使用包内 bootstrap: ${resolved.packageProfile.id} / ${resolved.pageRef.dataFile}`,
    );
    switchSessionToPackagePage(session, resolved.packageProfile, resolved.pageRef);
    session.packageProfile = resolved.packageProfile;
  } else {
    assertSharedPreloginExists(resolved.sharedPageId);
    console.log(`  使用共享 bootstrap: ${resolved.sharedPageId}（无匹配包内页）`);
    switchPageSession(session, resolved.sharedPageId);
  }
  await executePageFlow(session);
}

async function runLoginIfNeeded(
  session: AgentSession,
  skipLogin?: boolean,
  androidPackage?: string,
): Promise<boolean> {
  if (skipLogin) {
    console.log('  ⏭️ 跳过登录（skipLogin，假定已在 H5 目标页或首页）');
    return false;
  }
  console.log('\n========== 阶段 1: Login ==========');
  const resolved = resolvePreloginSource(androidPackage, 'login');
  if (resolved.mode === 'package' && resolved.packageProfile && resolved.pageRef) {
    console.log(
      `  使用包内 login: ${resolved.packageProfile.id} / ${resolved.pageRef.dataFile}`,
    );
    switchSessionToPackagePage(session, resolved.packageProfile, resolved.pageRef);
    session.packageProfile = resolved.packageProfile;
  } else {
    assertSharedPreloginExists(resolved.sharedPageId);
    console.log(`  使用共享 login: ${resolved.sharedPageId}（无匹配包内页）`);
    switchPageSession(session, resolved.sharedPageId);
  }
  await executePageFlow(session);
  return true;
}

/** 对齐 Appium：登录后先点击 Next/Apply/Go to repay，再进入子流程 */
async function postLoginRoute(
  session: AgentSession,
  options: {
    flowId: string;
    profile: AccountProfile | null;
    homeState?: HomeState;
  },
): Promise<{ homeState: HomeState | null; resolvedFlowId: string }> {
  const flow = loadFlowConfig(options.flowId);
  const skipTap = options.profile?.skipPostLoginTap === true || flow.skipPostLoginTap === true;

  if (skipTap) {
    console.log('\n========== 阶段 2: 首页检测（不点击主按钮） ==========');
    const state =
      options.homeState ??
      options.profile?.expectedHome ??
      (await detectHomeState(session));
    if (state) {
      console.log(`  检测到首页主按钮: ${state}`);
      const { syncH5SessionVars, runBeforeApplyCheckpoint } = await import('./l5/index.js');
      await syncH5SessionVars(session, `首页 ${state}`);
      if (state === 'Apply') {
        await runBeforeApplyCheckpoint(session, { skipJsExtract: true });
      }
    } else {
      console.log('  未识别到 Next / Apply / Go to repay（后续 home 页仍会校验）');
    }
    return {
      homeState: state,
      resolvedFlowId: options.flowId,
    };
  }

  const homeState =
    options.homeState ??
    options.profile?.expectedHome ??
    (await detectHomeState(session));

  if (!homeState) {
    throw new Error(
      '无法识别首页状态。请设置 ACCOUNT_PROFILE、--home-state，或确保首页有 Next/Apply/Go to repay',
    );
  }

  const tapTarget = flow.postLoginTap ?? homeState;
  console.log(`\n========== 阶段 2: 首页分流 → 点击「${tapTarget}」 ==========`);
  const { syncH5SessionVars, runBeforeApplyCheckpoint } = await import('./l5/index.js');
  await syncH5SessionVars(session, `首页 ${homeState}`);
  if (homeState === 'Apply' || tapTarget === 'Apply') {
    await runBeforeApplyCheckpoint(session, { skipJsExtract: true });
  }
  await tapHomeButton(session, tapTarget);

  let resolvedFlowId = options.flowId;
  if (options.flowId === 'business-auto') {
    resolvedFlowId = options.profile?.flow ?? HOME_FLOW_MAP[homeState];
    console.log(`  业务流解析: ${homeState} → ${resolvedFlowId}`);
  }

  return { homeState, resolvedFlowId };
}

async function runFixedPages(
  session: AgentSession,
  pageIds: string[],
  startIndex: number,
  pageTotal: number,
): Promise<void> {
  for (let i = 0; i < pageIds.length; i++) {
    const absIndex = startIndex + i;
    if (absIndex > 0 || session.meta.id !== pageIds[i]) {
      switchPageSession(session, pageIds[i]);
    }
    console.log(`\n========== 阶段 3+: 页面 ${absIndex + 1}/${pageTotal} — ${pageIds[i]} ==========`);
    await executePageFlow(session, { pageIndex: absIndex + 1, pageTotal });
  }
}

async function runPageSequence(
  session: AgentSession,
  pageIds: string[],
  startIndex = 0,
): Promise<void> {
  const pageTotal = pageIds.length;
  const segments = splitKycFlexibleSegments(pageIds.slice(startIndex));
  let cursor = startIndex;
  for (const seg of segments) {
    if (seg.kind === 'kyc') {
      await runKycFlexibleCluster(session, {
        pool: seg.pages,
        pageTotal,
        startPageIndex: cursor,
      });
    } else {
      await runFixedPages(session, seg.pages, cursor, pageTotal);
    }
    cursor += seg.pages.length;
  }
}

function applyCredentialOverride(
  profile: AccountProfile | null,
  options?: BusinessFlowOptions,
): AccountProfile | null {
  const mobile = options?.mobile?.trim();
  const otp = options?.otp?.trim();
  if (!mobile && !otp) return profile;
  const next: AccountProfile = {
    ...(profile ?? { mobile: '', otp: '' }),
    mobile: mobile || profile?.mobile || process.env.TEST_MOBILE || '',
    otp: otp || profile?.otp || process.env.TEST_OTP || '',
  };
  console.log(`>>> 登录凭证: ${next.mobile} / OTP ${next.otp}`);
  return next;
}

export async function runBusinessFlow(
  flowId: string,
  options?: BusinessFlowOptions,
): Promise<{ session: AgentSession; runId: string; homeState?: HomeState | null; mode: RunMode }> {
  const { finalizeRun } = await import('../reports/report-generator.js');
  clearResults();
  const runId = options?.runId ?? new Date().toISOString().replace(/[:.]/g, '-');
  const profile = applyCredentialOverride(
    resolveAccountProfile(options?.accountProfile),
    options,
  );
  const isAuto = flowId === 'business-auto';
  // 仅 business-auto 按账号分流改写流程；kyc-full 等显式 flow 不被 ACCOUNT_PROFILE 劫持。
  // 无 ACCOUNT_PROFILE 时保持 business-auto，登录后由 AI 识别首页按钮再映射子流程。
  let resolvedFlowId = isAuto && profile?.flow ? profile.flow : flowId;
  const flowCfg = loadFlowConfig(resolvedFlowId);
  const skipBootstrap = options?.skipBootstrap ?? process.env.SKIP_BOOTSTRAP === '1';
  const skipLogin =
    options?.skipLogin ??
    (process.env.SKIP_LOGIN === '1' || flowCfg.skipLogin === true);
  const skipLaunch = options?.skipLaunch ?? process.env.SKIP_LAUNCH === '1';
  // 模式按原始 flowId 判定，避免 business-auto 被 profile 改写后丢失全流程语义
  const mode = resolveRunMode(isAuto ? 'business-auto' : resolvedFlowId, {
    ...options,
    skipLogin,
  });

  console.log(`\n========== 业务流 ${resolvedFlowId}（模式: ${mode}） ==========\n`);
  if (isAuto && !profile?.flow) {
    console.log('提示: business-auto 将登录后 AI 识别 Next / Apply / Go to repay 并分流\n');
  } else if (flowCfg.skipLogin) {
    console.log(
      '提示: 本流程不含登录/首页分流（无 Next、apply-entry）。请先手动进入 KYC 任一步（基本信息/紧急联系人/OCR/活体/绑卡）再跑。\n',
    );
  } else if (skipLogin) {
    console.log('提示: 已设置 SKIP_LOGIN，假定设备已在目标页\n');
  } else if (mode === 'single-page') {
    console.log('提示: 单页模式假定设备已在目标页（skipNavigation=true）\n');
  }

  let homeState: HomeState | null = options?.homeState ?? null;

  const pageIdsForEntry = loadFlowPageIds(resolvedFlowId);
  const entryPageId = skipLogin
    ? pageIdsForEntry[options?.startPageIndex ?? 0] ?? pageIdsForEntry[0]
    : 'login';

  const session = await createAgentSession({
    pageId: entryPageId,
    runId,
    accountProfile: profile,
    allowDisabledPage: true,
    deviceId: options?.deviceId,
  });
  await connectSession(session);
  session.accountProfile = profile;
  // B 面模版：仅 common + loan；独立 App 专用 action 不可在此误用
  session.allowedActionDomains = B_SIDE_ACTION_DOMAINS;

  try {
    // 全流程（含登录）：先按配置打开指定包，再跑 bootstrap / 登录
    let androidPackage: string | undefined;
    if (!skipLogin) {
      androidPackage = resolveBusinessAndroidPackage({
        env: session.env,
        flowPackage: flowCfg.androidPackage,
        optionPackage: options?.androidPackage,
      });
      if (!skipLaunch && !androidPackage) {
        throw new Error(
          '全流程未配置要打开的 App 包名。请在 config/environment.yaml 设置 app.androidPackage，' +
            '或设置环境变量 ANDROID_PACKAGE，或 SKIP_LAUNCH=1 后手动打开 App。',
        );
      }
      const skipClear = process.env.SKIP_CLEAR_DATA === '1';
      await launchAndroidApp(session, androidPackage, {
        skipLaunch,
        // B 面全流程每次冷启前清缓存/存储，避免上次登录态挡住协议弹窗
        clearStorage: mode === 'full-flow' && !skipLaunch && !skipClear,
      });
    }

    // 不含登录的分段流程：直接跑 pages（如 kyc-full 五步）
    if (skipLogin) {
      const pageIds = loadFlowPageIds(resolvedFlowId);
      const startIdx = options?.startPageIndex ?? 0;
      await runPageSequence(session, pageIds, startIdx);
    } else if (mode === 'single-page') {
      const pageIds = loadFlowPageIds(resolvedFlowId);
      const idx = options?.startPageIndex ?? 0;
      switchPageSession(session, pageIds[idx]);
      await executePageFlow(session, { pageIndex: idx + 1, pageTotal: pageIds.length });
    } else {
      await runBootstrapIfNeeded(
        session,
        isAuto ? flowId : resolvedFlowId,
        skipBootstrap,
        androidPackage,
      );

      const didLogin = await runLoginIfNeeded(session, false, androidPackage);

      // 登录完成后进入共享 B 面模版：门禁回到 common+loan，不再沿用壳包域
      session.packageProfile = null;
      session.allowedActionDomains = B_SIDE_ACTION_DOMAINS;

      // business-auto 的 pages 只有 login，仍必须走首页分流；其它多页业务流同理
      const needsHomeRoute =
        didLogin &&
        resolvedFlowId !== 'login' &&
        (isAuto || loadFlowPageIds(resolvedFlowId).length > 1);

      if (needsHomeRoute) {
        const routed = await postLoginRoute(session, {
          // 传原始 business-auto，才能按 AI 检测结果映射到子流程
          flowId: isAuto ? 'business-auto' : resolvedFlowId,
          profile,
          homeState: options?.homeState,
        });
        homeState = routed.homeState;
        resolvedFlowId = routed.resolvedFlowId;
      }

      const pageIds = loadFlowPageIds(resolvedFlowId);
      if (isAuto && pageIds.length <= 1) {
        throw new Error(
          `business-auto 分流后仍无有效子流程页面（resolved=${resolvedFlowId}）。` +
            '请检查首页是否出现 Next/Apply/Go to repay，或设置 ACCOUNT_PROFILE。',
        );
      }

      let startIdx = options?.startPageIndex ?? 0;
      if (didLogin && pageIds[0] === 'login') startIdx = Math.max(startIdx, 1);

      await runPageSequence(session, pageIds, startIdx);
    }

    session.reportFilePath = session.agent.reportFile ?? null;
    finalizeRun(session);
  } catch (err) {
    session.reportFilePath = session.agent.reportFile ?? null;
    finalizeRun(session, err instanceof Error ? err.message : String(err));
    throw err;
  }

  return { session, runId, homeState, mode };
}
