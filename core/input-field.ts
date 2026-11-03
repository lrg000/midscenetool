import type { AndroidAgent } from '@midscene/android';
import type { AgentSession, InputField } from './types.js';
import { inputLocatePrompt, sleep } from './utils.js';
import { scrollToElement } from './scroll.js';
import { recordSkipped, runTest } from './test-context.js';
import { withAdbRetry } from './retry.js';

async function assertAi(agent: AndroidAgent, prompt: string, failMsg: string) {
  await withAdbRetry(async () => {
    const result = await agent.aiAssert(prompt, failMsg);
    if (result && !result.pass) {
      throw new Error(result.message ?? failMsg);
    }
  }, 'aiAssert');
}

async function dismissEmailSuffixPopup(session: AgentSession): Promise<void> {
  const { agent, env } = session;
  try {
    await agent.aiTap(
      'The "Whatsapp" field label or input area, tap to dismiss email suffix suggestions popup and keyboard',
    );
    await sleep(env.timing.afterDismiss);
  } catch {
    // ignore
  }
}

function resolveInputLocate(session: AgentSession, field: InputField): string {
  return field.locatePrompt ?? inputLocatePrompt(session.page.page.title, field.label);
}

/** 合并单值与数组配置，去重且保持顺序 */
export function resolveInputCases(
  singular: string | undefined,
  plural: string[] | undefined,
): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(plural ?? []), ...(singular !== undefined ? [singular] : [])]) {
    if (seen.has(v)) continue;
    seen.add(v);
    list.push(v);
  }
  return list;
}

function previewValue(value: string, maxLen = 24): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '(空)';
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}…` : compact;
}

async function maybeBlurField(session: AgentSession, field: InputField): Promise<void> {
  if (field.skipBlurAfterInput) return;
  await blurField(session, field.label);
}

/** 失焦必须点页面顶部标题；收起键盘不会触发校验。勿点 Gender / Date of Birth。 */
async function blurField(session: AgentSession, fieldLabel?: string): Promise<void> {
  const { agent, page, env } = session;

  const blurTargets =
    fieldLabel === 'Email ID'
      ? [
          'The "Whatsapp" field label or input area, tap to dismiss email suffix suggestions and keyboard',
          page.page.blurTarget,
          'An empty gray area of the form background outside the active input and keyboard',
        ]
      : page.page.id === 'kyc-aadhaar'
        ? [
            page.page.blurTarget,
            'The "Confirm your info" title text at the top of the white sheet',
            'The "Identity Verification" page header title at the very top of the screen',
          ]
        : page.page.id === 'bank-info'
          ? [
              page.page.blurTarget,
              'The "Bank information" or "Bank Account" title in the top header bar',
              'The "IFSC code" field label (tap the label text, not the input)',
            ]
        : [
            page.page.blurTarget,
            'The "Personal Information" section title on the form',
            'An empty gray area of the form background outside the active input and keyboard',
          ];

  for (const target of blurTargets) {
    try {
      await withAdbRetry(
        () =>
          agent.aiTap(
            `${target}, tap once on the page top title area to blur active input ` +
              `(do NOT tap Gender, Date of Birth, or any orange chevron)`,
          ),
        'blur',
      );
      await sleep(env.timing.afterBlur);
      return;
    } catch {
      // try next
    }
  }
}

async function setInputValue(
  session: AgentSession,
  field: InputField,
  value: string,
  options?: { autoDismissKeyboard?: boolean },
): Promise<void> {
  const { agent, env } = session;
  const locate = resolveInputLocate(session, field);
  const autoDismissKeyboard =
    options?.autoDismissKeyboard ?? field.autoDismissKeyboard ?? false;

  if (!field.skipScrollBeforeInput) {
    await withAdbRetry(() => scrollToElement(session, field.label, locate), `scroll ${field.label}`);
  }
  await withAdbRetry(
    () =>
      agent.aiInput(locate, {
        value,
        mode: value === '' ? 'clear' : 'replace',
        autoDismissKeyboard,
      }),
    `input ${field.label}`,
  );
  await sleep(env.timing.afterInput);

  if (field.label === 'Email ID') {
    await dismissEmailSuffixPopup(session);
  }
}

/** flow fill-input：仅填值，不跑 blur 测试套件 */
export async function fillInputField(
  session: AgentSession,
  field: InputField,
  value: string,
  options?: { autoDismissKeyboard?: boolean },
): Promise<void> {
  await setInputValue(session, field, value, options);
}

async function settleBetweenInputCases(session: AgentSession, fieldLabel: string): Promise<void> {
  const ms = session.env.timing.betweenCases ?? 700;
  if (fieldLabel === 'Email ID') {
    await dismissEmailSuffixPopup(session);
  }
  await sleep(ms);
}

async function assertFieldError(
  agent: AndroidAgent,
  field: InputField,
  mode: 'empty' | 'invalid',
): Promise<void> {
  const fieldLabel = field.label;
  const prompt =
    (mode === 'invalid' ? field.invalidErrorPrompt : undefined) ??
    (mode === 'empty'
      ? `Look ONLY at the "${fieldLabel}" field row. Ignore errors under other fields. ` +
        `This field shows empty/required error after blur: red error or hint text inside this input ` +
        `OR red text directly below THIS field. Red placeholder-like text inside an empty required field counts.`
      : `Look ONLY at the "${fieldLabel}" field row. Ignore errors under other fields. ` +
        `This field shows invalid input after blur: red error text in this input OR directly below THIS field ` +
        `(e.g. format hint in red).`);

  await assertAi(agent, prompt, `${fieldLabel} 应显示错误状态`);
}

async function assertFieldValid(agent: AndroidAgent, field: InputField): Promise<void> {
  const fieldLabel = field.label;
  const prompt =
    field.validAssertPrompt ??
    `Look ONLY at the "${fieldLabel}" field row. Ignore red errors under OTHER fields ` +
      `(for example do not treat "Account No. confirmation" errors as Account No. errors). ` +
      `THIS field contains the typed valid value and THIS row does NOT show red validation error text.`;
  await assertAi(agent, prompt, `${fieldLabel} 合法值仍显示错误`);
}

export async function testInputField(session: AgentSession, field: InputField): Promise<void> {
  const runOpts = {
    agent: session.agent,
    device: session.device,
    screenshotsDir: session.env.paths.screenshots,
    runId: session.runId,
  };

  console.log(`\n--- 输入框: ${field.label} ---`);

  if (field.skipInputTests) {
    recordSkipped(
      `${field.label} - 输入框校验`,
      '日期选择器/非文本字段，跳过失焦与空值校验',
    );
    return;
  }

  const invalidCases = resolveInputCases(field.invalidValue, field.invalidValues);
  const validCases = resolveInputCases(field.validValue, field.validValues);

  if (field.skipEmptyBlurTest) {
    // A 面/Bottom Sheet：失焦不做空值校验，不写入跳过记录
  } else {
    await runTest(`${field.label} - 空值失焦应提示错误`, async () => {
      await setInputValue(session, field, '');
      await maybeBlurField(session, field);
      await assertFieldError(session.agent, field, 'empty');
    }, runOpts);
    await settleBetweenInputCases(session, field.label);
  }

  if (field.skipInvalidBlurTest) {
    // 失焦不做非法值校验，不写入跳过记录
  } else if (invalidCases.length === 0) {
    recordSkipped(`${field.label} - 非法值失焦应提示错误`, '未配置 invalidValue / invalidValues');
  } else {
    for (const value of invalidCases) {
      const tag = previewValue(value);
      await runTest(`${field.label} - 非法值失焦应提示错误 [${tag}]`, async () => {
        await setInputValue(session, field, value);
        await maybeBlurField(session, field);
        await assertFieldError(session.agent, field, 'invalid');
      }, runOpts);
      await settleBetweenInputCases(session, field.label);
    }
  }

  if (validCases.length === 0) {
    recordSkipped(`${field.label} - 合法值失焦不应提示错误`, '未配置 validValue / validValues');
  } else if (field.skipValidBlurTest) {
    for (const value of validCases) {
      const tag = previewValue(value);
      await runTest(`${field.label} - 填入合法值 [${tag}]`, async () => {
        await setInputValue(session, field, value);
        await maybeBlurField(session, field);
      }, runOpts);
      await settleBetweenInputCases(session, field.label);
    }
  } else {
    for (const value of validCases) {
      const tag = previewValue(value);
      await runTest(`${field.label} - 合法值失焦不应提示错误 [${tag}]`, async () => {
        await setInputValue(session, field, value);
        await maybeBlurField(session, field);
        await assertFieldValid(session.agent, field);
      }, runOpts);
      await settleBetweenInputCases(session, field.label);
    }
  }
}
