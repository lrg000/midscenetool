import type { AgentSession } from './types.js';
import { sleep } from './utils.js';

export type HomeState = 'Next' | 'Apply' | 'Go to repay';

/** 只认借款卡片上的大主按钮；顺序 Next → Apply → Go to repay，避免底部 Tab「Repayment」误判 */
const HOME_BUTTONS: HomeState[] = ['Next', 'Apply', 'Go to repay'];

function primaryCtaPrompt(text: HomeState): string {
  return (
    `On the loan app H5 home page, look ONLY at the large primary action button on the main loan card ` +
    `(the wide dark/black button under Amount / Tenure / Details — NOT the bottom tab bar). ` +
    `Is that primary button's text exactly "${text}"? ` +
    `Do NOT count bottom navigation items like Home / Repayment / Profile. ` +
    `Answer only true or false.`
  );
}
/**
 * 关闭登录后挡住 H5 首页的可选层。
 * 常见：Passkey 引导 → Money Alerts On? → Plan your next loan（底下才是 Apply/Next）
 */
export async function dismissHomePopup(session: AgentSession): Promise<boolean> {
  let dismissedAny = false;

  for (let round = 0; round < 5; round++) {
    let dismissedThisRound = false;

    try {
      const passkey = await session.agent.aiBoolean(
        'Is the current screen a Passkey enrollment page? Typical signs: heading "Login faster with Passkey", ' +
          'a primary button "Create Passkey", and the text "Skip for now". Answer only true or false.',
      );
      const skipVisible =
        passkey ||
        (await session.agent.aiBoolean(
          'Is the exact text "Skip for now" visible on this screen together with "Passkey" or "Create Passkey"? ' +
            'Answer only true or false.',
        ));
      if (passkey || skipVisible) {
        console.log('  检测到 Passkey 引导，点击 Skip for now...');
        await session.agent.aiTap(
          'The text button whose visible text is exactly "Skip for now" on the Passkey enrollment screen. ' +
            'Do NOT tap Create Passkey, fingerprint, or the lock icon.',
        );
        await sleep(Math.max(session.env.timing.afterDismiss, 800));
        dismissedThisRound = true;
        dismissedAny = true;
      }
    } catch {
      // ignore
    }

    try {
      const moneyAlerts = await session.agent.aiBoolean(
        'Is a "Money Alerts On?" notification permission popup visible (Later / Turn On buttons)? Answer only true or false.',
      );
      if (moneyAlerts) {
        console.log('  检测到 Money Alerts 弹窗，点击 Later...');
        try {
          await session.agent.aiTap(
            'The "Later" button on the "Money Alerts On?" popup (not Turn On, not the X unless Later is missing)',
          );
        } catch {
          await session.agent.aiTap(
            'The X close icon on the "Money Alerts On?" popup',
          );
        }
        await sleep(session.env.timing.afterDismiss);
        dismissedThisRound = true;
        dismissedAny = true;
      }
    } catch {
      // ignore
    }

    try {
      const planPopup = await session.agent.aiBoolean(
        'Is a modal popup visible with text like "Plan your next loan" or "Timely repayment"? Answer only true or false.',
      );
      if (planPopup) {
        console.log('  检测到可选贷款计划弹窗，关闭中...');
        try {
          await session.agent.aiTap(
            'The X close icon or "Close" button on the "Plan your next loan" promotional modal',
          );
        } catch {
          await session.agent.aiTap(
            'The close control (X) at the top of the loan plan promotional modal',
          );
        }
        await sleep(session.env.timing.afterDismiss);
        dismissedThisRound = true;
        dismissedAny = true;
      }
    } catch {
      // ignore
    }

    if (!dismissedThisRound) break;
  }

  return dismissedAny;
}

export async function detectHomeCta(session: AgentSession): Promise<HomeState | null> {
  for (const text of HOME_BUTTONS) {
    const visible = await session.agent.aiBoolean(primaryCtaPrompt(text));
    if (visible) return text;
  }
  return null;
}

/** 检测首页状态：Next / Apply / Go to repay（只看借款卡片主按钮，忽略底部 Tab） */
export async function detectHomeState(session: AgentSession): Promise<HomeState | null> {
  await dismissHomePopup(session);
  return detectHomeCta(session);
}

export async function tapHomeButton(
  session: AgentSession,
  state: HomeState,
): Promise<void> {
  await dismissHomePopup(session);
  await session.agent.aiTap(
    `The large primary "${state}" button on the main loan card of the H5 home page ` +
      `(wide dark button under Amount/Tenure — NOT the bottom "Repayment" tab)`,
  );
  await sleep(session.env.timing.afterSubmit);
}

export const HOME_FLOW_MAP: Record<HomeState, string> = {
  Next: 'business-new-user',
  Apply: 'business-apply-only',
  'Go to repay': 'business-repay',
};
