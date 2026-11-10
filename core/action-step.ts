import type { AgentSession, ContactField, FlowStep } from './types.js';
import { getInputField } from './config-loader.js';
import { dismissHomePopup } from './home-router.js';
import { dismissKycUrgencyPopups, KYC_URGENCY_PAGE_IDS } from './kyc-popups.js';
import { fillInputField } from './input-field.js';
import { contactFieldLocatePrompt, optionOrdinal, safeAiCall, sleep } from './utils.js';
import { isElementVisible, scrollFieldIntoView, scrollPage, scrollToElement } from './scroll.js';
import { recordSkipped, runTest } from './test-context.js';
import { waitForKycLeavePage } from './submit.js';

/** optional tap-text：优先用 locatePrompt 条件句，避免 Welcome 上 "CONTINUE" 误匹配 */
function optionalTapVisibilityPrompt(step: FlowStep, text: string): string {
  const locate = step.locatePrompt?.trim();
  if (locate && /^(If |Only if|On )/i.test(locate)) {
    return `${locate} Should this control be tapped now? Answer only true or false.`;
  }
  return (
    `Is "${text}" visible and tappable on the current screen ` +
    `(case may differ, e.g. all caps ACCEPT & CONTINUE)? Answer only true or false.`
  );
}

/**
 * 收起软键盘：点系统导航栏右侧「∨」收起键（Samsung 等键盘打开时 Back 会变成 ∨）。
 * 禁止 keyevent ESC/BACK —— 会直接关掉 New Note Bottom Sheet。
 */
async function dismissSoftKeyboard(session: AgentSession): Promise<void> {
  try {
    const adb = await session.device.getAdb();
    const ime = await adb.shell('dumpsys input_method');
    const shown =
      /mInputShown=true/.test(ime) ||
      /mIsShowing=true/.test(ime) ||
      /isInputViewShown=true/.test(ime);
    if (!shown) {
      console.log('  软键盘未显示，跳过收键盘');
      return;
    }

    console.log('  软键盘可见，点击导航栏「∨」收起（不关弹层）...');
    try {
      await session.agent.aiTap(
        'The downward chevron / arrow-down "∨" button at the BOTTOM-RIGHT of the Android system navigation bar ' +
          '(keyboard hide control that replaces Back while the keyboard is open). ' +
          'Do NOT tap Home (circle), Recents, the New Note sheet, Save, text input, or dimmed area outside the sheet.',
      );
      await sleep(400);
    } catch {
      // AI 失败：点屏幕右下角导航条「∨」区域
      const sizeOut = await adb.shell('wm size');
      const m = String(sizeOut).match(/(\d+)x(\d+)/);
      const w = m ? Number(m[1]) : 720;
      const h = m ? Number(m[2]) : 1600;
      const x = Math.floor(w * 0.92);
      const y = Math.floor(h * 0.97);
      console.log(`  AI 未点到 ∨，改用坐标 tap ${x},${y}`);
      await adb.shell(`input tap ${x} ${y}`);
      await sleep(400);
    }

    const ime2 = await adb.shell('dumpsys input_method');
    const still =
      /mInputShown=true/.test(ime2) ||
      /mIsShowing=true/.test(ime2) ||
      /isInputViewShown=true/.test(ime2);
    if (still) {
      console.log('  键盘仍在，再点一次 ∨ 坐标...');
      const sizeOut = await adb.shell('wm size');
      const m = String(sizeOut).match(/(\d+)x(\d+)/);
      const w = m ? Number(m[1]) : 720;
      const h = m ? Number(m[2]) : 1600;
      await adb.shell(
        `input tap ${Math.floor(w * 0.92)} ${Math.floor(h * 0.97)}`,
      );
      await sleep(400);
    }
  } catch (err) {
    console.log(
      `  收键盘跳过: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function executeTapText(session: AgentSession, step: FlowStep, env: AgentSession['env']): Promise<void> {
  const text = step.assertPrompt ?? step.label;
  const locate =
    step.locatePrompt ??
    `The "${text}" button or clickable text on the current screen`;

  const bottomFields = new Set(session.page.page.bottomFields ?? []);
  const preferScroll =
    step.scrollBeforeTap === true ||
    (step.scrollBeforeTap !== false &&
      (bottomFields.has(text) || bottomFields.has(step.label)));

  // 弹层内禁止滑页重试时设 noScrollRetry: true；默认失败后可滑页查找
  const allowScrollRetry = step.noScrollRetry !== true;

  const tapOnce = () => session.agent.aiTap(locate);

  const tryTap = async (): Promise<boolean> => {
    try {
      await tapOnce();
      await sleep(env.timing.afterSubmit);
      return true;
    } catch {
      return false;
    }
  };

  // 1) 底部字段：先收键盘并滑入视野（不点 blurTarget，避免详情页误点标题/返回）
  if (preferScroll) {
    await dismissSoftKeyboard(session);
    await scrollToElement(session, step.label, locate, {
      downFirst: true,
      skipDismissSheet: true,
    });
    await scrollPage(session, 'down');
    await sleep(env.scroll.settleMs);
    if (await tryTap()) return;
  } else if (await tryTap()) {
    return;
  }

  // 2) 直接点失败 → 先收起键盘再点
  console.log(`  「${step.label}」未点到，先收起键盘再试...`);
  await dismissSoftKeyboard(session);
  await sleep(400);
  if (await tryTap()) return;

  // 3) 仍失败 → 向上/向下滑动查找（最后才失败）
  if (!allowScrollRetry) {
    throw new Error(
      `failed to locate element after dismiss-keyboard (scroll retry disabled for sheet): ${step.label}`,
    );
  }

  console.log(`  「${step.label}」收键盘后仍未找到，向上滑动页面查找...`);
  await scrollToElement(session, step.label, locate, {
    upFirst: true,
    skipDismissSheet: true,
  });
  if (await tryTap()) return;

  console.log(`  「${step.label}」上滑未找到，再向下滑动查找...`);
  await scrollToElement(session, step.label, locate, {
    downFirst: true,
    alwaysScrollDown: true,
    skipDismissSheet: true,
  });
  if (await tryTap()) return;

  // 4) 最后一次：再收键盘 + 上下各滑一轮后点
  console.log(`  「${step.label}」最后重试：再收键盘并上下滑动...`);
  await dismissSoftKeyboard(session);
  await scrollPage(session, 'up');
  await sleep(env.scroll.settleMs);
  await scrollPage(session, 'down');
  await sleep(env.scroll.settleMs);
  await tapOnce();
  await sleep(env.timing.afterSubmit);
}

async function isFullNameRowFilled(
  session: AgentSession,
  field: ContactField,
): Promise<boolean> {
  const { page } = session.page;
  return session.agent.aiBoolean(
    `On the "${page.title}" page, in the "${field.section}" section, look at the "Full Name" field row only. ` +
      `Does it show a selected contact name below the label (NOT the gray placeholder "${field.placeholder}", ` +
      `NOT "Select...", NOT empty)? Short names or names with non-English characters still count as filled. ` +
      `Answer only true or false.`,
  );
}

async function isMobileRowFilled(
  session: AgentSession,
  field: ContactField,
): Promise<boolean> {
  const { page } = session.page;
  const mobilePh = field.mobilePlaceholder ?? 'e.g.';
  return session.agent.aiBoolean(
    `On the "${page.title}" page, in the "${field.section}" section, look at the "Mobile" field row only. ` +
      `Does it show a phone number with at least 6 digits (NOT the gray placeholder like "${mobilePh}", NOT empty)? ` +
      `Answer only true or false.`,
  );
}

/** 对齐 Appium h5_section_fullname_filled：Full Name 或 Mobile 任一行已填即视为完成 */
async function isContactSectionFilled(
  session: AgentSession,
  field: ContactField,
): Promise<boolean> {
  const nameResult = await safeAiCall(() => isFullNameRowFilled(session, field));
  if (nameResult.ok && nameResult.value) return true;

  const mobileResult = await safeAiCall(() => isMobileRowFilled(session, field));
  if (mobileResult.ok && mobileResult.value) return true;

  if (!nameResult.ok && !mobileResult.ok) {
    throw nameResult.error ?? mobileResult.error;
  }
  return false;
}

async function dismissContactPermissionIfShown(session: AgentSession): Promise<void> {
  const { agent, env } = session;
  const prompts = [
    'Android permission dialog "Allow" button for contacts',
    'Button with text "Allow" or "While using the app" on contacts permission',
    'Button with text "允许" or "始终允许" on contacts permission',
  ];
  for (const p of prompts) {
    try {
      await agent.aiTap(`The ${p}`);
      await sleep(env.timing.afterDismiss);
      return;
    } catch {
      // try next
    }
  }
}

async function openContactPicker(session: AgentSession, field: ContactField): Promise<void> {
  const { agent, env } = session;
  const pageTitle = session.page.page.title;
  const locateName = `${field.section} ${field.label}`;
  const prompt = contactFieldLocatePrompt(pageTitle, field.section, field.label);

  // Full Name 在 Relationship 下方；Third 等底部区块易被误判「已可见」而不下滑
  await scrollToElement(session, locateName, prompt, {
    downFirst: true,
    alwaysScrollDown: true,
  });
  await scrollFieldIntoView(session, locateName, {
    skipLocate: true,
    section: field.section,
    fieldLabel: field.label,
  });

  if (!(await isElementVisible(agent, prompt))) {
    console.log(`  ${locateName} 仍未入屏，再向下滑...`);
    for (let i = 0; i < 2; i++) {
      await scrollPage(session, 'down');
      await sleep(env.scroll.settleMs);
      if (await isElementVisible(agent, prompt)) {
        console.log(`  已找到 "${locateName}"（追加向下 ${i + 1} 次）`);
        break;
      }
    }
  }

  await agent.aiTap(prompt);
  await sleep(env.timing.afterOpenDropdown);
}

async function pickNativeContact(session: AgentSession, index: number): Promise<void> {
  const { agent, env } = session;
  await dismissContactPermissionIfShown(session);
  const ordinal = optionOrdinal(index + 1);
  await agent.aiTap(
    `In the Android native contact picker list, tap the ${index + 1}${ordinal} visible contact row (not the search bar or header)`,
  );
  await sleep(env.timing.afterModalSelect);
  await dismissContactPermissionIfShown(session);
}

async function ensureBackOnReferencePage(session: AgentSession): Promise<void> {
  const title = session.page.page.title;
  const { env } = session;
  for (let i = 0; i < 3; i++) {
    await sleep(i === 0 ? env.timing.pageReady : 1000);
    const onPage = await session.agent.aiBoolean(
      `Is the "${title}" page visible in the WebView with section headers like "Primary Reference"? Answer only true or false.`,
    );
    if (onPage) return;
    console.log(`  等待返回 ${title} 页面... (${i + 1}/3)`);
  }
}

/** 同一次 run 内各紧急联系人 Full Name 去重（App 不允许相同联系人提交） */
interface ContactPickState {
  /** section -> 规范化后的姓名 */
  usedNames: Map<string, string>;
  /** 已成功选用的通讯录列表下标（0-based） */
  usedIndexes: Set<number>;
}

const contactPickStateByRun = new Map<string, ContactPickState>();
const MAX_CONTACT_INDEX = 9;
const MAX_UNIQUE_PICK_ATTEMPTS = 5;

function getContactPickState(runId: string): ContactPickState {
  let state = contactPickStateByRun.get(runId);
  if (!state) {
    state = { usedNames: new Map(), usedIndexes: new Set() };
    contactPickStateByRun.set(runId, state);
  }
  return state;
}

function normalizeContactName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isNameUsedByOtherSection(
  state: ContactPickState,
  section: string,
  name: string,
): boolean {
  const normalized = normalizeContactName(name);
  if (!normalized) return false;
  for (const [sec, nm] of state.usedNames) {
    if (sec !== section && nm === normalized) return true;
  }
  return false;
}

function nextFreeContactIndex(state: ContactPickState, preferred: number): number {
  const start = Math.max(0, preferred);
  for (let i = start; i <= MAX_CONTACT_INDEX; i++) {
    if (!state.usedIndexes.has(i)) return i;
  }
  for (let i = 0; i < start; i++) {
    if (!state.usedIndexes.has(i)) return i;
  }
  return start;
}

async function readFilledFullName(
  session: AgentSession,
  field: ContactField,
): Promise<string | null> {
  const { page } = session.page;
  try {
    const text = await session.agent.aiQuery<string>(
      `On the "${page.title}" page, in the "${field.section}" section, what is the exact contact name shown under "Full Name" ` +
        `(NOT the gray placeholder "${field.placeholder}", NOT "Select...")? ` +
        `Return ONLY the name text, or an empty string if it is still a placeholder.`,
    );
    const name = String(text ?? '').trim();
    if (!name) return null;
    const lower = name.toLowerCase();
    if (
      lower.includes('placeholder') ||
      lower === 'select...' ||
      lower === field.placeholder.trim().toLowerCase()
    ) {
      return null;
    }
    return name;
  } catch {
    return null;
  }
}

function registerPickedContact(
  state: ContactPickState,
  section: string,
  index: number | null,
  name: string | null,
): void {
  if (index != null && index >= 0) state.usedIndexes.add(index);
  if (name) state.usedNames.set(section, normalizeContactName(name));
}

async function waitContactFilled(
  session: AgentSession,
  field: ContactField,
  caseName: string,
): Promise<boolean> {
  for (let retry = 0; retry < 2; retry++) {
    if (await isContactSectionFilled(session, field)) return true;
    if (retry === 0) {
      console.log(`  ${caseName} 回填未就绪，等待后重试校验...`);
      await sleep(session.env.timing.echoRetry);
      await ensureBackOnReferencePage(session);
    }
  }
  return false;
}

/**
 * 选择与其它紧急联系人区块不同的通讯录项。
 * 预填姓名若与已选重复会强制重选；选后读回 Full Name 再校验唯一性。
 */
async function pickUniqueContact(
  session: AgentSession,
  field: ContactField,
  caseName: string,
): Promise<void> {
  const state = getContactPickState(session.runId);
  let startIndex = nextFreeContactIndex(state, field.contactIndex);

  for (let attempt = 0; attempt < MAX_UNIQUE_PICK_ATTEMPTS; attempt++) {
    const index = startIndex + attempt;
    if (index > MAX_CONTACT_INDEX) break;
    if (state.usedIndexes.has(index)) continue;

    await openContactPicker(session, field);
    await pickNativeContact(session, index);
    await ensureBackOnReferencePage(session);

    if (!(await waitContactFilled(session, field, caseName))) {
      console.log(`  ${caseName} 第 ${index + 1} 项回填失败，尝试下一项...`);
      continue;
    }

    const name = await readFilledFullName(session, field);
    if (name && isNameUsedByOtherSection(state, field.section, name)) {
      console.log(
        `  ${caseName} Full Name "${name}" 与其他紧急联系人重复，改选下一项...`,
      );
      continue;
    }

    registerPickedContact(state, field.section, index, name);
    console.log(
      name
        ? `  ${caseName} 已选择第 ${index + 1} 个联系人（${name}），与其他区块不重复`
        : `  ${caseName} 已选择第 ${index + 1} 个联系人，与其他区块不重复`,
    );
    return;
  }

  throw new Error(
    `${caseName} 无法选出与其他紧急联系人不同的 Full Name（已尝试错开通讯录序号）`,
  );
}

export async function testContactField(
  session: AgentSession,
  field: ContactField,
): Promise<void> {
  const caseName = `${field.section} / ${field.label}`;
  const runOpts = {
    agent: session.agent,
    screenshotsDir: session.env.paths.screenshots,
    runId: session.runId,
  };

  console.log(`\n--- 通讯录字段: ${caseName} ---`);

  await runTest(`${caseName} - 选择联系人并回填`, async () => {
    const state = getContactPickState(session.runId);

    if (await isContactSectionFilled(session, field)) {
      const existingName = await readFilledFullName(session, field);
      if (existingName && isNameUsedByOtherSection(state, field.section, existingName)) {
        console.log(
          `  ${caseName} 已有联系人 "${existingName}" 与其他区块重复，重新选择...`,
        );
      } else {
        registerPickedContact(state, field.section, null, existingName);
        console.log(
          existingName
            ? `  ${caseName} 已有联系人（${existingName}），跳过选择`
            : `  ${caseName} 已有联系人（Full Name 或 Mobile 已填），跳过选择`,
        );
        return;
      }
    }

    await pickUniqueContact(session, field, caseName);
  }, runOpts);
}

export async function runVerifyStep(session: AgentSession, step: FlowStep): Promise<void> {
  const prompt = step.assertPrompt ?? step.label;
  const retries = Math.max(1, step.retry ?? 1);
  const delayMs = step.retryDelayMs ?? session.env.timing.echoRetry ?? 500;
  const scrollDownBefore = Math.max(0, step.scrollDownBefore ?? 0);

  await runTest(`${step.label} - 页面校验`, async () => {
    // 小屏：底部文案往往不在首屏，校验前先滑入视野
    for (let s = 0; s < scrollDownBefore; s++) {
      console.log(`  校验前向下滑动（${s + 1}/${scrollDownBefore}）...`);
      await scrollPage(session, 'down');
    }
    if (step.locatePrompt) {
      console.log(`  滑动查找校验锚点「${step.label}」...`);
      await scrollToElement(session, step.label, step.locatePrompt, { downFirst: true });
    }

    let lastError: Error | null = null;
    for (let i = 0; i < retries; i++) {
      if (i > 0) {
        console.log(`  ${step.label} 校验未通过，向下滑动后重试 ${i + 1}/${retries}...`);
        await sleep(delayMs);
        await scrollPage(session, 'down');
        await sleep(session.env.scroll.settleMs);
      }
      const result = await session.agent.aiAssert(
        prompt,
        `${step.label} 页面校验失败`,
      );
      if (!result || result.pass) return;
      lastError = new Error(result.message ?? `${step.label} 页面校验失败`);
    }
    if (step.optional) {
      console.log(`  可选校验「${step.label}」未满足，跳过...`);
      return;
    }
    throw lastError ?? new Error(`${step.label} 页面校验失败`);
  }, {
    agent: session.agent,
    screenshotsDir: session.env.paths.screenshots,
    runId: session.runId,
  });
}

export async function runActionStep(session: AgentSession, step: FlowStep): Promise<void> {
  if (step.skip) {
    recordSkipped(`${step.label} - ${step.action}`, '配置为跳过（原生/人工步骤）');
    return;
  }

  const { assertActionDomainAllowed } = await import('./actions/domains.js');
  assertActionDomainAllowed(
    step.action,
    session.allowedActionDomains,
    session.packageProfile?.id ?? session.meta?.id,
  );

  const runOpts = {
    agent: session.agent,
    screenshotsDir: session.env.paths.screenshots,
    runId: session.runId,
  };
  const { env } = session;
  const waitSec =
    step.manualWaitSec ??
    env.kyc?.photoManualWaitSec ??
    300;

  await runTest(`${step.label} - ${step.action}`, async () => {
    switch (step.action) {
      case 'tap-next':
        await session.agent.aiTap(
          step.locatePrompt ??
            step.assertPrompt ??
            `The "Next" button at the bottom of the ${session.page.page.title} page`,
        );
        await sleep(env.timing.afterSubmit);
        if (KYC_URGENCY_PAGE_IDS.has(session.meta.id)) {
          await dismissKycUrgencyPopups(session);
        }
        break;

      case 'dismiss-kyc-urgency-popup':
        await dismissKycUrgencyPopups(session);
        break;

      case 'handle-credit-limit-popup': {
        // V2 Personal Next 后可能出现 Awesome 额度弹窗；也可能直接进入 Address
        const detectPrompt =
          step.assertPrompt ??
          'Is a full-screen or centered popup/modal visible that says "Awesome!" (or similar celebration about a higher credit / estimated loan limit) with a "Continue" button? Answer only true or false.';
        const continuePrompt =
          step.locatePrompt ??
          'The white "Continue" button on the Awesome credit-limit popup modal (ignore the green vConsole floating button)';

        let shown = false;
        for (let i = 0; i < 4; i++) {
          shown = await session.agent.aiBoolean(detectPrompt);
          if (shown) break;
          const onAddress = await session.agent.aiBoolean(
            'Without scrolling: is the "Address Information" section or a "Pincode" field visible on the Basic info page? Answer only true or false.',
          );
          if (onAddress) {
            console.log('  未出现额度弹窗，已在 Address 页（变体）');
            return;
          }
          await sleep(env.timing.afterSubmit);
        }
        if (!shown) {
          throw new Error('未出现 Awesome/额度弹窗，也未进入 Address 页');
        }
        await session.agent.aiTap(continuePrompt);
        await sleep(env.timing.afterSubmit);
        break;
      }

      case 'tap-submit':
        await session.agent.aiTap(
          step.locatePrompt ?? 'The "Submit" button on the current page',
        );
        await sleep(env.timing.afterSubmit);
        if (KYC_URGENCY_PAGE_IDS.has(session.meta.id)) {
          const left = await waitForKycLeavePage(session);
          if (!left) {
            throw new Error(
              `点击 Submit 后未离开「${session.page.page.title}」（仍在本页或转圈超时）`,
            );
          }
        }
        break;

      case 'tap-allow':
        try {
          await session.agent.aiTap(
            'The "Allow" button on camera or permission dialog, or Android permission Allow button',
          );
        } catch {
          console.log('  未检测到 Allow 按钮，继续...');
        }
        await sleep(env.timing.afterDismiss);
        break;

      case 'wait-app-ready': {
        // 冷启后常见界面都算就绪；默认文案品牌无关，贷款壳请在 YAML 写 assertPrompt
        const readyPrompt =
          step.assertPrompt ??
          'Has the Android app finished cold-start splash or blank loading, and is NOW showing ANY of: ' +
            '(1) system permission dialog with Allow / While using the app / Don\'t allow, ' +
            '(2) an agreement / privacy / terms dialog with Agree, Accept, Continue, or similar, ' +
            '(3) a login / welcome / onboarding screen with sign-in or phone entry, ' +
            '(4) the app home or main content? ' +
            'Answer true if any of these is visible. Answer false ONLY for pure splash, blank screen, or endless spinner with no buttons. ' +
            'Answer only true or false.';
        const maxAttempts = Math.max(
          1,
          step.manualWaitSec ?? env.timing.appReadyMaxAttempts ?? 20,
        );
        const pollMs = env.timing.appReadyPollMs ?? 1000;

        for (let i = 0; i < maxAttempts; i++) {
          let ready = false;
          try {
            ready = await session.agent.aiBoolean(readyPrompt);
          } catch {
            console.log(
              `  App 就绪检测第 ${i + 1}/${maxAttempts} 次 AI 调用失败，稍后重试...`,
            );
          }
          if (ready) {
            console.log(`  App 已就绪（第 ${i + 1} 次检测）`);
            return;
          }
          await sleep(pollMs);
        }
        console.log('  App 就绪检测超时，继续尝试后续步骤...');
        break;
      }

      case 'wait-page':
        if (!step.assertPrompt) throw new Error('wait-page 需要 assertPrompt');
        {
          // optional 默认短轮询（避免 Charter 等偶现页空等 12s）；必现页可用 manualWaitSec 加长
          const maxAttempts = Math.max(
            1,
            step.manualWaitSec ?? (step.optional ? 3 : 8),
          );
          for (let i = 0; i < maxAttempts; i++) {
            const visible = await session.agent.aiBoolean(
              `${step.assertPrompt}. Answer only true or false.`,
            );
            if (visible) return;
            await sleep(800);
          }
        }
        if (step.optional) {
          console.log(`  等待「${step.label}」超时（optional），继续下一步...`);
          return;
        }
        throw new Error(`等待页面超时: ${step.label}`);

      case 'wait-h5-home': {
        const { detectHomeCta, dismissHomePopup } = await import('./home-router.js');
        const maxAttempts = Math.max(1, step.manualWaitSec ?? 15);
        for (let i = 0; i < maxAttempts; i++) {
          await dismissHomePopup(session);
          const cta = await detectHomeCta(session);
          if (cta) {
            console.log(`  已进入 H5 首页（主按钮: ${cta}，第 ${i + 1} 次）`);
            return;
          }
          const homeish = await session.agent.aiBoolean(
            'Is the loan app H5 home visible (loan amount/tenure/card, or bottom tabs Home / Repayment / Profile), ' +
              'and is this NOT a Passkey / OTP / Welcome login screen? Answer only true or false.',
          );
          if (homeish) {
            console.log(`  已进入 H5 首页（第 ${i + 1} 次，主按钮稍后识别）`);
            return;
          }
          await sleep(800);
        }
        throw new Error(`等待页面超时: ${step.label}`);
      }

      case 'dismiss-keyboard': {
        console.log('  收起软键盘（点导航栏 ∨，不关弹层）...');
        await dismissSoftKeyboard(session);
        break;
      }

      case 'relaunch-if-not': {
        // assertPrompt = 就绪布尔描述；locatePrompt = androidPackage
        if (!step.assertPrompt) throw new Error('relaunch-if-not 需要 assertPrompt（就绪条件）');
        const androidPackage =
          step.locatePrompt ??
          (() => {
            throw new Error(`relaunch-if-not 步骤「${step.label}」缺少 locatePrompt（androidPackage）`);
          })();
        const ready = await session.agent.aiBoolean(
          `${step.assertPrompt}. Answer only true or false.`,
        );
        if (ready) {
          console.log(`  「${step.label}」已就绪，跳过杀进程重开`);
          break;
        }
        console.log(`  「${step.label}」未就绪，force-stop + relaunch ${androidPackage}`);
        await session.device.terminate(androidPackage);
        await sleep(env.timing.afterDismiss ?? 800);
        await session.agent.launch(androidPackage);
        await sleep(env.timing.pageReady ?? 1500);
        break;
      }

      case 'kyc-manual-until': {
        if (!step.assertPrompt) throw new Error('kyc-manual-until 需要 assertPrompt');
        const ocrWait =
          step.manualWaitSec ?? env.kyc?.ocrManualWaitSec ?? env.kyc?.photoManualWaitSec ?? 600;
        const deadline = Date.now() + ocrWait * 1000;
        console.log(
          `  入口已确认，请人工完成「${step.label}」（最多 ${ocrWait}s，检测到目标后自动继续）...`,
        );
        while (Date.now() < deadline) {
          const visible = await session.agent.aiBoolean(
            `${step.assertPrompt}. Answer only true or false.`,
          );
          if (visible) {
            console.log('  检测到目标页面，继续自动化');
            return;
          }
          await sleep(5000);
        }
        throw new Error(`人工等待超时: ${step.label}`);
      }

      case 'kyc-photo-manual': {
        const deadline = Date.now() + waitSec * 1000;
        console.log(`  等待 Aadhaar 拍照/选图完成（最多 ${waitSec}s，可人工操作）...`);
        while (Date.now() < deadline) {
          const ready = await session.agent.aiBoolean(
            'Is Aadhaar photo preview visible with a Submit button (or Retake)? Answer only true or false.',
          );
          if (ready) {
            console.log('  检测到 Aadhaar 预览页');
            return;
          }
          await sleep(5000);
        }
        throw new Error('Aadhaar 拍照/选图超时（自动检测与人工等待均未完成）');
      }

      case 'kyc-selfie-capture': {
        const captureWait = env.kyc?.selfieCaptureWaitSec ?? 45;
        const deadline = Date.now() + captureWait * 1000;
        console.log(`  等待静默活体自拍完成（最多 ${captureWait}s）...`);
        while (Date.now() < deadline) {
          const preview = await session.agent.aiBoolean(
            'Is selfie preview visible with Submit and/or Retake buttons? Answer only true or false.',
          );
          if (preview) return;
          await sleep(2000);
        }
        throw new Error('静默活体自拍未完成或未回到预览页');
      }

      case 'tap-text': {
        const text = step.assertPrompt ?? step.label;

        if (step.optional) {
          const visQ = optionalTapVisibilityPrompt(step, text);
          let visible = await session.agent.aiBoolean(visQ);
          if (!visible) {
            console.log(`  未出现「${step.label}」，向上滑动最多 3 次再找...`);
            for (let i = 0; i < 3 && !visible; i++) {
              await scrollPage(session, 'up');
              await sleep(env.scroll.settleMs);
              visible = await session.agent.aiBoolean(visQ);
            }
          }
          if (!visible) {
            console.log(`  滑动后仍无「${step.label}」，跳过（非必现入口）...`);
            recordSkipped(`${step.section} / ${step.label}`, '可选入口未出现');
            break;
          }
          try {
            await executeTapText(session, { ...step, noScrollRetry: true }, env);
          } catch {
            console.log(`  可选步骤「${step.label}」点击未成功，跳过...`);
            recordSkipped(`${step.section} / ${step.label}`, '可选入口点击失败');
          }
          break;
        }

        await executeTapText(session, step, env);
        break;
      }

      case 'fill-input': {
        if (step.inputValue === undefined) {
          throw new Error(`fill-input 步骤「${step.label}」缺少 inputValue`);
        }
        const fieldLabel = step.inputFieldLabel ?? step.label;
        const field = getInputField(session.page, fieldLabel, step.section);
        await runTest(step.label, async () => {
          // New Note 输入：若弹层未开则先打开（避免软失败后继续点 Save）
          if (fieldLabel === 'Write something...') {
            const sheetOpen = await session.agent.aiBoolean(
              'Is "New Note" bottom sheet open with a text input? Answer only true or false.',
            );
            if (!sheetOpen) {
              console.log('  填入前 New Note 未打开，先点击 + ...');
              await session.agent.aiTap(
                'Yellow circular FAB "+" bottom-right on Notes. Do NOT tap elsewhere.',
              );
              await sleep(1500);
              const ok = await session.agent.aiBoolean(
                'Is "New Note" bottom sheet open now? Answer only true or false.',
              );
              if (!ok) {
                throw new Error('填入便签失败：New Note 弹层未打开');
              }
            }
          }
          await fillInputField(session, field, step.inputValue!, {
            autoDismissKeyboard: step.autoDismissKeyboard,
          });
        }, {
          agent: session.agent,
          device: session.device,
          screenshotsDir: env.paths.screenshots,
          runId: session.runId,
        });
        break;
      }

      case 'ensure-calendar-home': {
        const calendarPrompt =
          'Is Daily Grid CALENDAR home the main screen: top month/year title (e.g. August 2026), Sun-Sat weekday row, and date number grid visible? ' +
          'NOT the full-screen day schedule page (date header + list + FAB only, no month grid). Answer only true or false.';
        if (await session.agent.aiBoolean(calendarPrompt)) {
          console.log('  已在月历首页');
          break;
        }
        console.log('  当前不在月历（可能在行程页），尝试返回...');
        for (let i = 0; i < 4; i++) {
          const onDay = await session.agent.aiBoolean(
            'Is day schedule page the main content (date + weekday header, schedule list or "No Schedule", FAB "+") without month grid? Answer only true or false.',
          );
          if (onDay) {
            try {
              await session.agent.aiTap(
                'Back arrow (<) top-left of day schedule header to return to calendar',
              );
              await sleep(env.timing.afterSubmit ?? 800);
            } catch {
              // ignore
            }
          } else {
            try {
              await session.agent.back();
              await sleep(500);
            } catch {
              // ignore
            }
          }
          if (await session.agent.aiBoolean(calendarPrompt)) {
            console.log('  已返回月历首页');
            break;
          }
        }
        if (!(await session.agent.aiBoolean(calendarPrompt))) {
          const androidPackage = step.assertPrompt ?? 'com.dailygrid.lifecaptured.app';
          console.log(`  仍不在月历，force-stop 并 relaunch: ${androidPackage}`);
          await session.device.terminate(androidPackage);
          await sleep(400);
          await session.agent.launch(androidPackage);
          await sleep(env.timing.pageReady ?? 2000);
        }
        break;
      }

      case 'ensure-y20-clean-state': {
        const emptyPrompt =
          'On the day schedule page, is empty state "No Schedule" visible with NO schedule cards in the list? Answer only true or false.';
        if (await session.agent.aiBoolean(emptyPrompt)) {
          console.log('  已是空状态，无需清理残留行程');
          break;
        }
        console.log('  检测到残留行程，自动清理...');
        for (let i = 0; i < 8; i++) {
          const hasCard = await session.agent.aiBoolean(
            'Is any schedule card row visible on the day schedule list (with trash/delete icon on the right)? Answer only true or false.',
          );
          if (!hasCard) break;
          try {
            await session.agent.aiTap(
              'Trash or delete icon on the first/top schedule card row (right side). Do NOT tap FAB.',
            );
            await sleep(400);
            const dialog = await session.agent.aiBoolean(
              'Is dialog "Delete this schedule?" visible with Cancel and Delete buttons? Answer only true or false.',
            );
            if (dialog) {
              await session.agent.aiTap(
                'The "Delete" button on "Delete this schedule?" dialog (NOT "Cancel")',
              );
              await sleep(env.timing.afterSubmit ?? 800);
            }
          } catch {
            console.log(`  清理第 ${i + 1} 条时未能点击删除，停止清理`);
            break;
          }
        }
        break;
      }

      case 'ensure-y26-clean-state': {
        const emptyPrompt =
          'On the day schedule page, is empty state "Nothing planned" (and/or "Add a schedule for this day.") visible with NO schedule rows? Answer only true or false.';
        if (await session.agent.aiBoolean(emptyPrompt)) {
          console.log('  已是空状态（Nothing planned），无需清理');
          break;
        }
        console.log('  检测到残留行程，自动清理（Y26）...');
        for (let i = 0; i < 8; i++) {
          const hasRow = await session.agent.aiBoolean(
            'Is any schedule row visible (time + title, optional trash icon)? Answer only true or false.',
          );
          if (!hasRow) break;
          try {
            await session.agent.aiTap(
              'Trash/delete icon on the first/top schedule row (right side). Do NOT tap + Add Schedule.',
            );
            await sleep(400);
            const dialog = await session.agent.aiBoolean(
              'Is dialog "Delete this schedule?" visible with Cancel and Delete? Answer only true or false.',
            );
            if (dialog) {
              await session.agent.aiTap(
                'The "Delete" button on "Delete this schedule?" dialog (NOT "Cancel")',
              );
              await sleep(env.timing.afterSubmit ?? 800);
            }
          } catch {
            console.log(`  清理第 ${i + 1} 条失败，停止`);
            break;
          }
        }
        break;
      }

      case 'ensure-y22-clean-state': {
        // 若在详情页，先返回列表
        for (let i = 0; i < 3; i++) {
          const onDetail = await session.agent.aiBoolean(
            'Is note detail page visible (header "Note" with back arrow and delete icon, full note body)? Answer only true or false.',
          );
          if (!onDetail) break;
          try {
            await session.agent.aiTap(
              'Back arrow top-left of note detail header (‹ Note). Do NOT tap delete.',
            );
            await sleep(env.timing.afterSubmit ?? 800);
          } catch {
            break;
          }
        }
        const emptyPrompt =
          'On Notes list home: is empty state "No Notes Yet" visible with NO note cards? Answer only true or false.';
        if (await session.agent.aiBoolean(emptyPrompt)) {
          console.log('  已是空状态，无需清理残留便签');
          break;
        }
        console.log('  检测到残留便签，自动清理...');
        for (let i = 0; i < 10; i++) {
          const hasCard = await session.agent.aiBoolean(
            'Is any note card visible on the Notes list (title/preview/time, optional trash icon)? Answer only true or false.',
          );
          if (!hasCard) break;
          try {
            // 优先列表卡上删除；若无图标则进详情删
            const listTrash = await session.agent.aiBoolean(
              'Is a trash/delete icon visible on the first/top note card on Notes list? Answer only true or false.',
            );
            if (listTrash) {
              await session.agent.aiTap(
                'Trash/delete icon on the first/top note card on Notes list. Do NOT tap + or card body.',
              );
            } else {
              await session.agent.aiTap(
                'The first/top note card body on Notes list to open detail. Do NOT tap +.',
              );
              await sleep(600);
              await session.agent.aiTap(
                'Trash/delete icon top-right on note detail header. Do NOT tap back.',
              );
            }
            await sleep(400);
            const dialog = await session.agent.aiBoolean(
              'Is dialog "Delete this note?" visible with Cancel and Delete buttons? Answer only true or false.',
            );
            if (dialog) {
              await session.agent.aiTap(
                'The "Delete" button on "Delete this note?" dialog (NOT "Cancel")',
              );
              await sleep(env.timing.afterSubmit ?? 800);
            }
          } catch {
            console.log(`  清理第 ${i + 1} 条便签失败，停止清理`);
            break;
          }
        }
        break;
      }

      case 'ensure-new-schedule-sheet': {
        const open = await session.agent.aiBoolean(
          'Is "New Schedule" bottom sheet open (placeholder like "Enter your schedule..." OR "What are you planning?", and Save / Save Schedule)? Answer only true or false.',
        );
        if (open) {
          console.log('  New Schedule 弹层已打开');
          break;
        }
        console.log('  弹层未打开，点击 + / Add Schedule 重新打开...');
        try {
          await session.agent.aiTap(
            'Open New Schedule: tap circular FAB "+" OR button "+ Add Schedule" on day schedule page. ' +
              'Do NOT tap back or existing schedule rows. Accent may be blue #3B82F6 or forest green #245C4A.',
          );
        } catch {
          await session.agent.aiTap(
            'The "+" control or "Add Schedule" text button on the day schedule empty/list page',
          );
        }
        await sleep(env.timing.afterOpenDropdown ?? 800);
        break;
      }

      case 'ensure-new-note-sheet': {
        const sheetPrompt =
          'Is a "New Note" bottom sheet / modal open (title "New Note" and text field "Write something...")? ' +
          'Keyboard may be visible. Answer only true or false.';

        const tapFab = async () => {
          try {
            await session.agent.aiTap(
              'The yellow circular floating action button with black "+" at the bottom-RIGHT corner of the Notes screen. ' +
                'Tap the center of that yellow circle only. Do NOT tap system navigation bar, back, or empty-state icon.',
            );
          } catch {
            // AI 定位失败时用屏幕右下角坐标点 FAB（避开系统导航条）
            const adb = await session.device.getAdb();
            const sizeOut = await adb.shell('wm size');
            const m = String(sizeOut).match(/(\d+)x(\d+)/);
            const w = m ? Number(m[1]) : 720;
            const h = m ? Number(m[2]) : 1600;
            const x = Math.floor(w * 0.88);
            const y = Math.floor(h * 0.88);
            console.log(`  AI 未点到 FAB，改用坐标 tap ${x},${y}`);
            await adb.shell(`input tap ${x} ${y}`);
          }
          await sleep(Math.max(env.timing.afterOpenDropdown ?? 800, 1500));
        };

        let open = false;
        try {
          open = await session.agent.aiBoolean(sheetPrompt);
        } catch {
          open = false;
        }

        for (let attempt = 0; attempt < 4 && !open; attempt++) {
          console.log(
            attempt === 0
              ? '  New Note 未打开，点击 + 打开...'
              : `  New Note 仍未打开，重试点击 +（${attempt + 1}/4）...`,
          );
          await tapFab();
          try {
            open = await session.agent.aiBoolean(sheetPrompt);
          } catch {
            open = false;
          }
        }

        if (!open) {
          throw new Error('无法打开 New Note：多次点击 + 后仍未见 New Note 弹层');
        }
        console.log('  New Note 弹层已打开');
        break;
      }

      case 'close-new-note-sheet': {
        const open = await session.agent.aiBoolean(
          'Is "New Note" bottom sheet still open? Answer only true or false.',
        );
        if (!open) break;
        for (const tapPrompt of [
          'The "Cancel" text/button on New Note bottom sheet (NOT Save)',
          'Dimmed area outside New Note sheet to dismiss',
          'Android back / gesture to close New Note sheet without saving',
        ]) {
          try {
            await session.agent.aiTap(tapPrompt);
            await sleep(env.timing.afterDismiss ?? 500);
            const stillOpen = await session.agent.aiBoolean(
              'Is "New Note" bottom sheet still open? Answer only true or false.',
            );
            if (!stillOpen) break;
          } catch {
            // try next
          }
        }
        break;
      }

      case 'close-new-schedule-sheet': {
        const open = await session.agent.aiBoolean(
          'Is "New Schedule" bottom sheet still open? Answer only true or false.',
        );
        if (!open) break;
        for (const tapPrompt of [
          'The "Cancel" text/button on New Schedule bottom sheet header or bottom (NOT Save)',
          'The sheet drag handle or dimmed area outside sheet to dismiss (if Cancel not visible)',
          'Back arrow top-left of day schedule header to leave sheet',
        ]) {
          try {
            await session.agent.aiTap(tapPrompt);
            await sleep(env.timing.afterDismiss ?? 500);
            const stillOpen = await session.agent.aiBoolean(
              'Is "New Schedule" bottom sheet still open? Answer only true or false.',
            );
            if (!stillOpen) break;
          } catch {
            // try next
          }
        }
        break;
      }

      case 'force-stop-app': {
        const androidPackage =
          step.assertPrompt ??
          (() => {
            throw new Error(`force-stop-app 步骤「${step.label}」缺少 assertPrompt（androidPackage）`);
          })();
        console.log(`  force-stop: ${androidPackage}`);
        await session.device.terminate(androidPackage);
        await sleep(env.timing.afterDismiss ?? 500);
        break;
      }

      case 'relaunch-app': {
        const androidPackage =
          step.assertPrompt ??
          (() => {
            throw new Error(`relaunch-app 步骤「${step.label}」缺少 assertPrompt（androidPackage）`);
          })();
        await session.agent.launch(androidPackage);
        await sleep(env.timing.pageReady ?? 1500);
        break;
      }

      case 'uninstall-app': {
        const androidPackage =
          step.assertPrompt ??
          (() => {
            throw new Error(`uninstall-app 步骤「${step.label}」缺少 assertPrompt（androidPackage）`);
          })();
        console.log(`  卸载 App: ${androidPackage}`);
        const adb = await session.device.getAdb();
        const ok = await adb.uninstallApk(androidPackage);
        if (!ok) {
          throw new Error(`卸载失败或未安装: ${androidPackage}`);
        }
        await sleep(env.timing.afterDismiss ?? 500);
        break;
      }

      case 'install-apk': {
        const apkPath =
          step.assertPrompt?.trim() ||
          process.env.ASIDE_APK_PATH?.trim() ||
          process.env.Y26_APK_PATH?.trim() ||
          process.env.Y25_APK_PATH?.trim() ||
          process.env.Y24_APK_PATH?.trim() ||
          process.env.Y22_APK_PATH?.trim() ||
          process.env.Y20_APK_PATH?.trim() ||
          (() => {
            throw new Error(
              `install-apk 步骤「${step.label}」缺少 assertPrompt（apk 路径）或环境变量 ASIDE_APK_PATH / Y26_APK_PATH / Y25_APK_PATH / Y24_APK_PATH / Y22_APK_PATH / Y20_APK_PATH`,
            );
          })();
        console.log(`  安装 APK: ${apkPath}`);
        const adb = await session.device.getAdb();
        await adb.installOrUpgrade(apkPath);
        await sleep(env.timing.pageReady ?? 1500);
        break;
      }

      case 'dismiss-home-popup':
        await dismissHomePopup(session);
        break;

      case 'handle-permissions': {
        const allowPrompts = [
          'Android permission dialog "Allow" button',
          'Permission controller Allow button',
          'Button with text "Allow" or "While using the app"',
          'Button with text "允许" or "始终允许"',
        ];
        for (let round = 0; round < 3; round++) {
          const hasDialog = await session.agent.aiBoolean(
            'Is an Android SYSTEM permission dialog visible (Allow / While using the app / 允许 / 始终允许)? ' +
              'NOT in-app Terms/Privacy web pages, NOT Welcome login buttons. Answer only true or false.',
          );
          if (!hasDialog) break;

          let handled = false;
          for (const p of allowPrompts) {
            try {
              await session.agent.aiTap(`The ${p}`);
              await sleep(env.timing.afterDismiss);
              handled = true;
            } catch {
              // try next
            }
          }
          if (!handled) break;
        }
        break;
      }

      case 'pick-native-contact': {
        const index = step.contactIndex ?? 0;
        await dismissContactPermissionIfShown(session);
        await pickNativeContact(session, index);
        await sleep(env.timing.afterModalSelect);
        await dismissContactPermissionIfShown(session);
        const pageTitle = session.page.page.title;
        for (let i = 0; i < 6; i++) {
          const back = await session.agent.aiBoolean(
            `Is the "${pageTitle}" form visible again (not the Android contact picker list)? Answer only true or false.`,
          );
          if (back) break;
          await sleep(500);
        }
        break;
      }

      case 'seed-gallery-image': {
        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const localHint =
          step.assertPrompt?.trim() ||
          step.locatePrompt?.trim() ||
          'packages/y24/fixtures/y24-test-photo.png';
        const localPath = pathMod.isAbsolute(localHint)
          ? localHint
          : pathMod.resolve(process.cwd(), localHint);
        if (!fsMod.existsSync(localPath)) {
          throw new Error(`seed-gallery-image 找不到本地图片: ${localPath}`);
        }
        const baseName = pathMod.basename(localPath);
        const remotePath = `/sdcard/Pictures/${baseName}`;
        console.log(`  seed-gallery-image: ${localPath} → ${remotePath}`);
        const adb = await session.device.getAdb();
        await adb.push(localPath, remotePath);
        await adb.shell(
          `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${remotePath}`,
        );
        await sleep(env.timing.afterDismiss ?? 800);
        break;
      }

      case 'pick-gallery-image': {
        // 系统图片选择器：点第 N 张缩略图；若出现 Done/Add/勾选则确认（Samsung/Photos 多选器）
        const index = step.contactIndex ?? 0;
        const ordinal = optionOrdinal(index + 1);
        await sleep(env.timing.afterOpenDropdown ?? 800);
        const stillPicker = await session.agent.aiBoolean(
          'Is an Android system photo/image picker visible (Photos/Collections grid, Gallery, DocumentsUI, or bottom sheet with photo thumbnails and Done/Add)? Answer only true or false.',
        );
        if (!stillPicker) {
          console.log('  pick-gallery-image: 未检测到系统选择器，跳过点选');
          break;
        }
        await session.agent.aiTap(
          step.locatePrompt ??
            `In the Android system photo picker grid, tap the ${index + 1}${ordinal} visible image thumbnail ` +
              `(not Photos/Collections tabs, not Settings, not Preview). Prefer an unselected photo cell.`,
        );
        await sleep(env.timing.afterModalSelect ?? 800);
        for (let confirmRound = 0; confirmRound < 3; confirmRound++) {
          const needDone = await session.agent.aiBoolean(
            'Is the system photo picker still open with a "Done" / "Add" / "勾选" / checkmark confirm control ' +
              '(often bottom-right after selecting photos)? Answer only true or false.',
          );
          if (!needDone) break;
          try {
            await session.agent.aiTap(
              'The primary confirm button "Done" or "Add" or checkmark at the bottom of the photo picker ' +
                '(NOT Preview, NOT X close, NOT Settings)',
            );
            await sleep(env.timing.afterModalSelect ?? 1000);
          } catch {
            console.log('  pick-gallery-image: 确认按钮点击失败，继续');
            break;
          }
        }
        break;
      }

      case 'android-back': {
        console.log('  android-back (keyevent 4)');
        const adb = await session.device.getAdb();
        await adb.shell('input keyevent 4');
        await sleep(env.timing.afterDismiss ?? 600);
        break;
      }

      case 'usage-access': {
        // 有引导弹窗：Setting → 开开关 → 返回；无弹窗：直接进入下一步
        try {
          const guideVisible = await session.agent.aiBoolean(
            'Is an in-app popup visible about Usage access / "Permits and increase the success rate" with a black "Setting" button? Answer only true or false.',
          );
          if (!guideVisible) {
            console.log('  未出现 Usage Access 引导弹窗，跳过授权，继续下一步...');
            break;
          }

          console.log('  检测到 Usage Access 引导弹窗，点击 Setting...');
          await session.agent.aiTap(
            'The black "Setting" button at the bottom of the Usage access / "Permits and increase the success rate" popup (not the X close icon)',
          );
          await sleep(env.timing.afterSubmit);

          let onSettings = false;
          for (let i = 0; i < 8; i++) {
            onSettings = await session.agent.aiBoolean(
              'Is the Android system "Usage data access" / Usage Access settings screen visible (title like "Usage data access" or "Allow usage tracking")? Answer only true or false.',
            );
            if (onSettings) break;
            await sleep(500);
          }

          if (!onSettings) {
            throw new Error('点击 Setting 后未进入 Usage Access 设置页');
          }

          const alreadyOn = await session.agent.aiBoolean(
            'On the "Usage data access" screen, is the "Allow usage tracking" toggle already ON (blue / enabled / switched to the right)? Answer only true or false.',
          );
          if (alreadyOn) {
            console.log('  Usage Access 已开启，返回 App...');
          } else {
            console.log('  Usage Access 未开启，点击开关开启...');
            await session.agent.aiTap(
              'The "Allow usage tracking" toggle switch on the right side of the Usage data access screen (tap to turn it ON)',
            );
            await sleep(env.timing.afterDismiss);

            const nowOn = await session.agent.aiBoolean(
              'Is the "Allow usage tracking" toggle now ON (blue / enabled)? Answer only true or false.',
            );
            if (!nowOn) {
              throw new Error('Usage Access 开关未能开启');
            }
            console.log('  Usage Access 已开启');
          }

          try {
            await session.agent.aiTap(
              'The back arrow (<) in the top-left of the "Usage data access" settings header',
            );
          } catch {
            try {
              await session.agent.back();
            } catch {
              // ignore
            }
          }
          await sleep(env.timing.afterSubmit);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  Usage Access 处理异常: ${msg}`);
          throw err;
        }
        break;
      }

      case 'handle-auto-disburse-popup': {
        // 还款详情点 Repay 后可能出现；也可能直接进支付选择页
        const detectPrompt =
          step.assertPrompt ??
          'Is a centered popup/modal titled "Enable Auto-disburse on schedule" (or similar auto-disburse) visible with buttons "Enable Auto-disburse" and "Cancel"? Answer only true or false.';
        const enablePrompt =
          step.locatePrompt ??
          'The solid dark primary button labeled "Enable Auto-disburse" on the auto-disburse popup (NOT Cancel, NOT the Automatic Loan Disbursement Agreement link, ignore green vConsole)';

        let shown = false;
        for (let i = 0; i < 4; i++) {
          shown = await session.agent.aiBoolean(detectPrompt);
          if (shown) break;
          const paymentUi = await session.agent.aiBoolean(
            'Is a payment method selection, UPI/app chooser, browser chooser, or repayment confirmation already visible (and no Enable Auto-disburse popup)? Answer only true or false.',
          );
          if (paymentUi) {
            console.log('  未出现 Auto-disburse 弹窗，已进入支付/确认页');
            return;
          }
          await sleep(env.timing.afterSubmit);
        }
        if (!shown) {
          console.log('  未检测到 Auto-disburse 弹窗，继续...');
          return;
        }
        console.log('  检测到 Auto-disburse 弹窗，点击 Enable Auto-disburse...');
        await session.agent.aiTap(enablePrompt);
        await sleep(env.timing.afterSubmit);
        break;
      }

      case 'tap-repay-loan':
        await session.agent.aiTap(
          'The first "Repay Loan" button or card on the home/repay page',
        );
        await sleep(env.timing.afterSubmit);
        break;

      case 'tap-repay':
        await session.agent.aiTap(
          'The "Repay" button at the bottom of the Repayment Details page',
        );
        await sleep(env.timing.afterSubmit);
        break;

      case 'tap-confirm': {
        const confirmPrompt =
          step.locatePrompt ??
          'The "Confirm" button on the Success dialog or page after loan application (not vConsole)';
        let ready = false;
        for (let i = 0; i < 8; i++) {
          ready = await session.agent.aiBoolean(
            'Is a loan application Success page or dialog visible with a Confirm button? ' +
              'This is NOT the home Amount/Apply card. Answer only true or false.',
          );
          if (ready) break;
          console.log(`  等待 Success/Confirm（${i + 1}/8）...`);
          await sleep(env.timing.afterSubmit ?? 2000);
        }
        if (!ready) {
          throw new Error('未出现申请成功页 Confirm（仍可能停在首页 Apply）');
        }
        await session.agent.aiTap(confirmPrompt);
        await sleep(env.timing.afterSubmit);
        break;
      }

      case 'tap-apply-if-visible': {
        const hasApply = await session.agent.aiBoolean(
          'Is the H5 loan home the primary screen, with an Amount slider (e.g. ₹ 5000), Tenure, ' +
            'and a black bottom primary button labeled exactly "Apply"? ' +
            'Do NOT count tab bar labels. Do NOT count if a Success page/dialog is already showing. ' +
            'Answer only true or false.',
        );
        if (hasApply) {
          const { runBeforeApplyCheckpoint } = await import('./l5/index.js');
          await runBeforeApplyCheckpoint(session);
          await session.agent.aiTap(
            'The black "Apply" button at the bottom of the H5 loan amount card (not vConsole, not tab bar)',
          );
          await sleep(env.timing.afterSubmit);
        } else {
          console.log('  未检测到 Apply 按钮，跳过（可能已点过 Apply，或已在权限/Success）');
        }
        break;
      }

      case 'wait-apply-visible': {
        const { waitForH5ApplyButton } = await import('./l5/webview-js.js');
        const ok = await waitForH5ApplyButton(session, {
          maxAttempts: step.manualWaitSec ?? 15,
          optional: step.optional === true,
        });
        if (!ok && step.optional) {
          recordSkipped(`${step.section} / ${step.label}`, '未检测到 H5 Apply 按钮');
        }
        break;
      }

      default:
        throw new Error(`未知 action: ${step.action}`);
    }
  }, runOpts);
}
