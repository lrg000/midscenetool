import type { AgentSession, CheckboxField } from './types.js';
import { sleep } from './utils.js';
import { scrollToElement } from './scroll.js';
import { runTest } from './test-context.js';

function checkboxLocatePrompt(pageTitle: string, label: string, field?: CheckboxField): string {
  if (field?.locatePrompt?.trim()) return field.locatePrompt.trim();

  // T53 冷启协议弹窗（仅 title 命中）
  if (pageTitle.toLowerCase().includes('before you continue')) {
    return (
      'On the white "Before you continue" modal: the empty square checkbox LEFT of the text ' +
      '"I agree to the Terms of Service, Privacy Policy and Permissions Declaration." ' +
      'Tap ONLY the empty square box — do NOT tap Terms of Service / Privacy Policy / Permissions Declaration ' +
      'blue link rows, Continue, Decline, or the X close icon'
    );
  }
  // T53 登录 Welcome 底栏（title=Login）
  if (
    pageTitle.toLowerCase() === 'login' &&
    (label.includes('Terms of Service') || label.includes('Permissions Declaration'))
  ) {
    return (
      'On the Anantapur Chakra login / Welcome screen: the EMPTY square checkbox outline ' +
      'at the BOTTOM-LEFT, immediately to the LEFT of the sentence starting with "I agree to the". ' +
      'Tap the CENTER of that small empty square ONLY. ' +
      'Do NOT tap any blue underlined words (Terms of Service, Privacy Policy, Permissions Declaration). ' +
      'Do NOT tap Continue with Truecaller, Continue with Google, or Use Mobile Number.'
    );
  }
  if (label.includes('Terms of Service') || label.includes('Terms & Conditions')) {
    return (
      'The small square consent checkbox on the far bottom-left of the Welcome/login screen, ' +
      'immediately LEFT of the text "I agree to the Terms of Service" or "I agree to the Terms & Conditions". ' +
      'Tap ONLY the empty square box — do NOT tap the underlined Terms / Privacy / Permissions link text, ' +
      'Continue with Truecaller, Continue with Google, or Use Mobile Number'
    );
  }
  if (label.includes('Charter of Operation')) {
    return (
      'The square checkbox to the left of the text "I have read and agree to the Charter of Operation" ' +
      '(or "I confirm compliance with the Charter of Operation") on the Charter of Operation page or Welcome. ' +
      'Tap ONLY the square checkbox — do NOT tap CONTINUE, Truecaller, Google, or Phone Code buttons'
    );
  }
  if (label.includes('I have reviewed the KFS')) {
    return (
      'The square checkbox LEFT of "I have reviewed the KFS" on the Key Fact Statement page. ' +
      'Tap ONLY the checkbox — do NOT tap Continue or back'
    );
  }
  return `The checkbox for "${label}" on the ${pageTitle} page`;
}

function checkboxCheckedPrompt(pageTitle: string, label: string, field?: CheckboxField): string {
  if (field?.checkedPrompt?.trim()) return field.checkedPrompt.trim();

  if (pageTitle.toLowerCase().includes('before you continue')) {
    return (
      'On the "Before you continue" modal: is the square checkbox next to ' +
      '"I agree to the Terms of Service, Privacy Policy and Permissions Declaration." checked ' +
      '(filled with a check mark)? Answer only true or false.'
    );
  }
  if (
    pageTitle.toLowerCase() === 'login' &&
    (label.includes('Terms of Service') || label.includes('Permissions Declaration'))
  ) {
    return (
      'On the Anantapur Chakra login / Welcome screen: is the square checkbox to the LEFT of ' +
      '"I agree to the Terms of Service, Privacy Policy and Permissions Declaration." checked ' +
      '(filled / tick mark inside the box)? Answer only true or false.'
    );
  }
  if (label.includes('Terms of Service') || label.includes('Terms & Conditions')) {
    return (
      'Is the consent checkbox next to "I agree to the Terms of Service" / Terms & Conditions / Privacy Policy ' +
      'checked (filled/blue with a check mark)? Answer only true or false.'
    );
  }
  if (label.includes('Charter of Operation')) {
    return (
      'Is the checkbox next to "I have read and agree to the Charter of Operation" ' +
      '(or "I confirm compliance with the Charter of Operation") checked ' +
      '(filled with a check mark)? Answer only true or false.'
    );
  }
  if (label.includes('I have reviewed the KFS')) {
    return (
      'Is the checkbox next to "I have reviewed the KFS" checked (filled with a check mark)? ' +
      'Answer only true or false.'
    );
  }
  return `Is the "${label}" checkbox already checked on ${pageTitle} page? Answer only true or false.`;
}

export async function testCheckboxField(
  session: AgentSession,
  field: CheckboxField,
): Promise<void> {
  const { page, env } = session;
  const pageTitle = page.page.title;
  const locate = checkboxLocatePrompt(pageTitle, field.label, field);
  const checkedQ = checkboxCheckedPrompt(pageTitle, field.label, field);
  const runOpts = {
    agent: session.agent,
    screenshotsDir: env.paths.screenshots,
    runId: session.runId,
  };

  console.log(`\n--- 勾选框: ${field.label} ---`);

  await runTest(`${field.label} - 应勾选同意条款`, async () => {
    // 登录底栏勾选：不做大范围滑动，避免顶开键盘/误触
    const skipScroll =
      pageTitle.toLowerCase() === 'login' ||
      pageTitle.toLowerCase().includes('before you continue');
    if (!skipScroll) {
      await scrollToElement(session, field.label, locate);
    }

    let checked = await session.agent.aiBoolean(checkedQ);
    for (let attempt = 0; attempt < 3 && !checked; attempt++) {
      console.log(`  勾选尝试 ${attempt + 1}/3...`);
      await session.agent.aiTap(locate);
      await sleep(Math.max(env.timing.afterInput, 600));
      checked = await session.agent.aiBoolean(checkedQ);
    }
    if (!checked) throw new Error(`${field.label} 勾选失败`);
    // 勾选后等 UI 稳定，再点 Use Mobile Number
    await sleep(Math.max(env.timing.afterInput, 500));
  }, runOpts);
}
