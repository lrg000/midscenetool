import type { AgentSession } from './types.js';
import { sleep } from './utils.js';

/** 与 kyc-router 五步 id 一致，避免 page-executor ↔ kyc-router 循环引用 */
export const KYC_URGENCY_PAGE_IDS = new Set([
  'basic-info',
  'reference-contacts',
  'kyc-aadhaar',
  'kyc-liveness',
  'bank-info',
]);

const ANY_URGENCY_MODAL = `
Is a centered white marketing/urgency modal overlay covering the form (page behind is dimmed)
with any of these:
- title like "Only 10 slots remain" and an orange button "Get Mine"
- "You're ahead of 99% of users" and an orange button "Continue Now"
- "10 MINUTES LEFT" (or 10 minutes countdown) and a red/orange button "Complete Now"
- "Only 10 Slots Left Today" (or Daily Quota Claimed) and a red button "Continue Now"
Do NOT count the black bottom "Next" button, green vConsole, native Android permission dialogs,
or the Awesome credit-limit popup.
Answer only true or false.`.trim();

const TAP_URGENCY_CTA = `
The prominent orange or red CTA on the centered marketing/urgency modal:
"Get Mine" or "Continue Now" or "Complete Now".
Do NOT tap the black "Next" at the bottom of the page.
Do NOT tap green vConsole.`;

/**
 * 离开基本信息 / 紧急联系人 / OCR / 绑卡后可能出现的营销倒计时弹窗（不必弹）。
 * 不点掉会挡住下一页表单，定位不到 Relationship / PAN / Next 等而卡住。
 */
export async function dismissKycUrgencyPopups(session: AgentSession): Promise<boolean> {
  let dismissed = false;
  for (let round = 0; round < 2; round++) {
    let visible = false;
    try {
      visible = await session.agent.aiBoolean(ANY_URGENCY_MODAL);
    } catch {
      visible = false;
    }
    if (!visible) break;
    console.log('  检测到 KYC 营销/倒计时弹窗，点击 Get Mine / Continue Now / Complete Now...');
    try {
      await session.agent.aiTap(TAP_URGENCY_CTA);
      await sleep(session.env.timing.afterDismiss ?? 250);
      dismissed = true;
    } catch {
      console.log('  营销弹窗点击失败，忽略（可能已关闭）');
      break;
    }
  }
  return dismissed;
}
