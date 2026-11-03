import type { AgentSession, FlowStep } from './types.js';
import { getCredentials } from './credentials.js';
import { sleep } from './utils.js';
import { runTest } from './test-context.js';

function defaultLocatePrompt(step: FlowStep): string {
  if (step.locatePrompt) return step.locatePrompt;

  if (step.valueKey === 'otp') {
    return (
      'The text input field with placeholder "Enter OTP" inside the white "Enter OTP" dialog/modal. ' +
      'Tap the input box center — not Change Number, not Resend, not the X close icon'
    );
  }

  // mobile — T53 等为 Mobile Number 弹窗（无 +91）；T42 为 Login with OTP 弹窗
  return (
    'The mobile number text input: either (1) inside the white "Mobile Number" dialog with placeholder "Mobile Number", ' +
    'or (2) inside "Login with OTP" dialog to the right of "+91" with placeholder "Enter mobile number". ' +
    'Tap the input box center — not Send OTP, not the X close icon, not the dimmed area outside the dialog'
  );
}

function readyPrompt(step: FlowStep): string {
  if (step.assertPrompt) {
    const p = step.assertPrompt.trim();
    return p.endsWith('?') ? `${p} Answer only true or false.` : `${p}? Answer only true or false.`;
  }
  if (step.valueKey === 'otp') {
    return 'Is the "Enter OTP" dialog or verification-code UI visible? Answer only true or false.';
  }
  return (
    'Is a Mobile Number / Login with OTP dialog visible with a phone input and Send OTP ' +
    '(with or without "+91")? Answer only true or false.'
  );
}

async function waitForLoginInputReady(session: AgentSession, step: FlowStep): Promise<void> {
  // 前面通常已有 wait-page；此处只做短确认，避免再空转 10 轮 AI
  for (let i = 0; i < 4; i++) {
    const ready = await session.agent.aiBoolean(readyPrompt(step));
    if (ready) {
      await sleep(200);
      return;
    }
    await sleep(400);
  }
}

export async function runNativeInputStep(
  session: AgentSession,
  step: FlowStep,
): Promise<void> {
  const creds = getCredentials(session.accountProfile);
  const value = step.valueKey === 'otp' ? creds.otp : creds.mobile;
  const locate = defaultLocatePrompt(step);
  const runOpts = {
    agent: session.agent,
    screenshotsDir: session.env.paths.screenshots,
    runId: session.runId,
  };

  await runTest(`${step.label} - 原生输入`, async () => {
    await waitForLoginInputReady(session, step);
    await session.agent.aiInput(locate, {
      value,
      mode: 'replace',
      // 默认不收键盘（T42 弹窗）；全屏 Phone Code 页在 YAML 设 autoDismissKeyboard: true
      autoDismissKeyboard: step.autoDismissKeyboard ?? false,
    });
    await sleep(session.env.timing.afterInput);
  }, runOpts);
}
