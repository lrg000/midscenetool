import type { AgentSession } from './types.js';
import { sleep } from './utils.js';
import { scrollToElement } from './scroll.js';
import { runTest } from './test-context.js';
import { dismissKycUrgencyPopups, KYC_URGENCY_PAGE_IDS } from './kyc-popups.js';

/** 框架默认：仍停本页则再点 Next（environment.yaml / 单页 YAML 可覆盖） */
const DEFAULT_RETRY_TAP_IF_STAY = 2;
const DEFAULT_RETRY_DELAY_MS = 2000;

async function assertAi(
  session: AgentSession,
  prompt: string,
  failMsg: string,
): Promise<void> {
  const result = await session.agent.aiAssert(prompt, failMsg);
  if (result && !result.pass) {
    throw new Error(result.message ?? failMsg);
  }
}

async function isStillOnSubmitPage(session: AgentSession): Promise<boolean> {
  const { page } = session;
  const prompt =
    page.submit.stayOnPagePrompt ??
    `Is the "${page.page.title}" page still the primary screen with its form fields still editable (navigation to the next step has NOT completed)? Answer only true or false.`;
  try {
    return await session.agent.aiBoolean(prompt);
  } catch {
    return true;
  }
}

function resolveRetryTap(session: AgentSession): number {
  const fromPage = session.page.submit.retryTapIfStay;
  if (fromPage !== undefined) return Math.max(0, fromPage);
  const fromEnv = session.env.submit?.retryTapIfStay;
  if (fromEnv !== undefined) return Math.max(0, fromEnv);
  return DEFAULT_RETRY_TAP_IF_STAY;
}

function resolveRetryDelay(session: AgentSession): number {
  const fromPage = session.page.submit.retryDelayMs;
  if (fromPage !== undefined) return fromPage;
  const fromEnv = session.env.submit?.retryDelayMs;
  if (fromEnv !== undefined) return fromEnv;
  return session.env.timing.afterSubmit ?? DEFAULT_RETRY_DELAY_MS;
}

export async function submitAndVerifyNextPage(session: AgentSession): Promise<void> {
  const { page, env } = session;
  if (!page.submit?.enabled) {
    console.log('\n--- 提交步骤已禁用，跳过 ---');
    return;
  }

  console.log('\n--- 提交并验证跳转 ---');

  const nextPrompt = `${page.submit.buttonPrompt} (tap the left-center of the black Next bar, avoid the green vConsole on the right)`;
  await scrollToElement(session, 'Next', nextPrompt);

  const runOpts = {
    agent: session.agent,
    screenshotsDir: env.paths.screenshots,
    runId: session.runId,
  };

  if (page.submit.requireEnabled) {
    await runTest('Next 按钮应可点击（字段已填完）', async () => {
      const enabled = await session.agent.aiBoolean(
        `Is the "Next" button at the bottom enabled and clickable (not grayed out)? Answer only true or false.`,
      );
      if (!enabled) throw new Error('Next 按钮不可用，请确认所有字段已填写');
    }, runOpts);
  }

  const retryTap = resolveRetryTap(session);
  const retryDelay = resolveRetryDelay(session);
  let leftAfterTap = false;

  let contactsUi: Record<string, unknown> | undefined;
  if (session.meta.id === 'reference-contacts') {
    const { isL5Enabled, captureEmergencyContactsUi } = await import('./l5/index.js');
    if (isL5Enabled()) {
      console.log('  提交前抽取紧急联系人 UI（离开后无法识图；不重复拉 H5 JS）...');
      contactsUi = await captureEmergencyContactsUi(session);
      await scrollToElement(session, 'Next', nextPrompt);
    }
  }

  await runTest('点击 Next 提交表单', async () => {
    await session.agent.aiTap(nextPrompt);
    await sleep(env.timing.afterSubmit);
    if (KYC_URGENCY_PAGE_IDS.has(session.meta.id)) {
      await dismissKycUrgencyPopups(session);
    }

    for (let i = 0; i < retryTap; i++) {
      const stayed = await isStillOnSubmitPage(session);
      if (!stayed) {
        leftAfterTap = true;
        console.log('  已离开当前页，无需重试 Next');
        return;
      }
      console.log(`  仍停在当前页，重试点 Next（${i + 1}/${retryTap}）...`);
      await scrollToElement(session, 'Next', nextPrompt);
      await session.agent.aiTap(nextPrompt);
      await sleep(retryDelay);
      if (KYC_URGENCY_PAGE_IDS.has(session.meta.id)) {
        await dismissKycUrgencyPopups(session);
      }
    }
  }, runOpts);

  await runTest('验证跳转到下一页', async () => {
    if (retryTap > 0) await sleep(Math.min(800, retryDelay));
    if (leftAfterTap) {
      const still = await isStillOnSubmitPage(session);
      if (!still) {
        console.log('  stayOnPage 已确认离开（下一页标题可能仍共用 Identity Verification）');
        return;
      }
    }
    await assertAi(session, page.submit.nextPageAssert, '点击 Next 后未跳转到下一页');
  }, runOpts);

  const stillHere = await isStillOnSubmitPage(session);
  if (stillHere) {
    throw new Error(
      `点击 Next 后仍停在「${page.page.title}」，未进入下一步（请避开 vConsole 再点黑色 Next）`,
    );
  }

  if (contactsUi) {
    const { runAfterEmergencyContactsCheckpoint } = await import('./l5/index.js');
    await runAfterEmergencyContactsCheckpoint(session, contactsUi);
  }
}
