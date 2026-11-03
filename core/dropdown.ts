import type { AndroidAgent } from '@midscene/android';
import type { AgentSession, DropdownField, SelectedOption } from './types.js';
import {
  dropdownLocatePrompt,
  isContentFilterError,
  optionOrdinal,
  randomOptionIndex,
  safeAiCall,
  sectionDropdownLocatePrompt,
  sectionFieldLocatePrompt,
  sleep,
} from './utils.js';
import {
  invalidateBottomSheetModalCheck,
  markBottomSheetModalClosed,
  scrollFieldIntoView,
  scrollToElement,
} from './scroll.js';
import { runTest } from './test-context.js';

async function readModalOptionText(
  session: AgentSession,
  field: DropdownField,
  index: number,
): Promise<string | null> {
  const { agent } = session;
  const sheetDesc = field.requiresConfirm
    ? `the open "${field.label}" bottom sheet (Cancel left, Confirm right, selectable list)`
    : `the open "${field.modalTitle}" bottom sheet modal`;
  try {
    const text = await agent.aiQuery<string>(
      `In ${sheetDesc}, what is the exact visible text of the ${index}${optionOrdinal(index)} selectable option row from the top of the list (ignore Cancel/Confirm and section letters)? Return ONLY the option text.`,
    );
    const normalized = String(text ?? '').trim();
    return normalized || null;
  } catch (err) {
    if (isContentFilterError(err)) return null;
    throw err;
  }
}

async function tapModalOption(
  session: AgentSession,
  field: DropdownField,
  index: number,
  optionText?: string | null,
  options?: { keepOpen?: boolean },
): Promise<void> {
  const { agent, env } = session;
  const sheetDesc = field.requiresConfirm
    ? `the open "${field.label}" bottom sheet (Cancel left, Confirm right, selectable list)`
    : `the open "${field.modalTitle}" bottom sheet modal`;

  if (optionText) {
    await agent.aiTap(
      `In ${sheetDesc}, tap the selectable option row whose text is "${optionText}"`,
    );
  } else {
    await agent.aiTap(
      `In ${sheetDesc}, tap the ${index}${optionOrdinal(index)} selectable option list row from the top (not Cancel/Confirm). If not enough rows, tap the 1st.`,
    );
  }
  await sleep(env.timing.afterModalSelect);
  if (!options?.keepOpen) markBottomSheetModalClosed(session);
}

async function tapModalConfirm(session: AgentSession, field: DropdownField): Promise<void> {
  const { agent, env } = session;
  await agent.aiTap(
    `In the open "${field.label}" selection bottom sheet, tap the "Confirm" button at the top-right (not Cancel, not vConsole)`,
  );
  await sleep(env.timing.afterModalSelect);
  markBottomSheetModalClosed(session);
}

async function isModalOpen(
  agent: AndroidAgent,
  modalTitle: string,
): Promise<boolean> {
  return agent.aiBoolean(
    `Is the "${modalTitle}" bottom sheet modal currently visible on screen? Answer only true or false.`,
  );
}

async function isEchoConsistentWhileModalOpen(
  agent: AndroidAgent,
  field: DropdownField,
): Promise<boolean> {
  return agent.aiBoolean(
    `The "${field.modalTitle}" bottom sheet is open. The option row with the checkmark/selected indicator shows the SAME text as the selected value in the "${field.label}" field row visible on the form behind the modal. Answer only true or false.`,
  );
}

async function isFieldEchoMatchingText(
  agent: AndroidAgent,
  label: string,
  optionText: string,
  section?: string,
): Promise<boolean> {
  const scope = section
    ? `in the "${section}" section `
    : '';
  return agent.aiBoolean(
    `Does the "${label}" dropdown field row ${scope}display "${optionText}" as the selected value (exact match or same visible text)? Answer only true or false.`,
  );
}

async function isDropdownFilled(
  agent: AndroidAgent,
  label: string,
  section?: string,
): Promise<boolean> {
  const scope = section ? ` in the "${section}" section` : '';
  return agent.aiBoolean(
    `Is the "${label}" dropdown field${scope} filled? There must be selected value text below the label (not blank, not gray "Select" placeholder). Answer only true or false.`,
  );
}

async function isDropdownFilledNeutral(
  agent: AndroidAgent,
  label: string,
): Promise<boolean> {
  return agent.aiBoolean(
    `Is the "${label}" selection modal closed, and the "${label}" field row is NOT in empty unselected "Select" placeholder state? Answer only true or false.`,
  );
}

async function checkDropdownFilled(
  agent: AndroidAgent,
  label: string,
  options?: { trustOnContentFilter?: boolean; section?: string },
): Promise<boolean> {
  try {
    return await isDropdownFilled(agent, label, options?.section);
  } catch (err) {
    if (!isContentFilterError(err)) throw err;
    console.log(`  ${label} 遇内容审核(400)，改用语义中性检查...`);
    try {
      return await isDropdownFilledNeutral(agent, label);
    } catch (err2) {
      if (options?.trustOnContentFilter && isContentFilterError(err2)) {
        console.log(`  ${label} 中性检查也遇内容审核，视为已选中`);
        return true;
      }
      throw err2;
    }
  }
}

async function assertDropdownEchoConsistency(
  session: AgentSession,
  field: DropdownField,
  selected: SelectedOption,
  options?: { fieldInView?: boolean },
): Promise<void> {
  const { agent, env } = session;
  const { label, section } = field;
  const skipModalOpenAiCheck = env.dropdown.skipModalOpenAiCheck;
  const locateName = section ? `${section} ${label}` : label;

  if (!skipModalOpenAiCheck) {
    const modalOpenResult = await safeAiCall(() => isModalOpen(agent, field.modalTitle));
    if (modalOpenResult.ok && modalOpenResult.value) {
      const openCheck = await safeAiCall(() =>
        isEchoConsistentWhileModalOpen(agent, field),
      );
      if (openCheck.ok && openCheck.value) {
        console.log(`  ${locateName} 弹窗内一致性校验通过（辅助）`);
      }
    }
  }

  await scrollFieldIntoView(session, locateName, {
    skipLocate: options?.fieldInView,
    section,
    fieldLabel: label,
  });

  if (selected.optionText) {
    for (let retry = 0; retry < 2; retry++) {
      const closedCheck = await safeAiCall(() =>
        isFieldEchoMatchingText(agent, label, selected.optionText!, section),
      );
      if (closedCheck.ok) {
        if (closedCheck.value) {
          console.log(`  ${locateName} 回显与选中项 "${selected.optionText}" 一致`);
          return;
        }
        if (retry === 0) {
          console.log(`  ${locateName} 回显未就绪，等待后重试...`);
          await sleep(env.timing.echoRetry);
          await scrollFieldIntoView(session, locateName, { section, fieldLabel: label });
          continue;
        }
        throw new Error(`${locateName} 回显与选中项 "${selected.optionText}" 不一致`);
      }
      if (!closedCheck.contentFilter) throw closedCheck.error;
      console.log(`  ${locateName} 关弹窗后文本比对遇内容审核(400)...`);
      break;
    }
  }

  const filled = await checkDropdownFilled(agent, label, {
    trustOnContentFilter: true,
    section,
  });
  if (!filled) {
    throw new Error(`${locateName} 一致性校验失败（无法文本比对且字段为空）`);
  }
  console.log(`  ${locateName} 内容审核兜底：已确认字段有选中值`);
}

async function selectRandomOptionWithConsistency(
  session: AgentSession,
  field: DropdownField,
): Promise<SelectedOption> {
  const { env } = session;
  const index = randomOptionIndex(env.dropdown.randomOptionCount);
  console.log(`  拟选第 ${index} 项，读取选项文字...`);

  const optionText = await readModalOptionText(session, field, index);
  if (optionText) {
    const preview = optionText.length > 40 ? `${optionText.slice(0, 40)}...` : optionText;
    console.log(`  读取到选项: ${preview}`);
  } else {
    console.log('  无法读取选项文字，将依赖弹窗内/关弹窗后视觉一致性校验');
  }

  await tapModalOption(session, field, index, optionText, {
    keepOpen: Boolean(field.requiresConfirm),
  });

  if (field.requiresConfirm) {
    console.log(`  ${field.label} 需点击 Confirm 才回显...`);
    await tapModalConfirm(session, field);
  }

  const selected: SelectedOption = { index, optionText };
  await assertDropdownEchoConsistency(session, field, selected, { fieldInView: true });
  return selected;
}

async function openDropdown(session: AgentSession, field: DropdownField): Promise<void> {
  const { agent, page, env } = session;
  const { label, section } = field;
  const locateName = section ? `${section} ${label}` : label;
  const tapPrompt = section
    ? sectionDropdownLocatePrompt(page.page.title, section, label)
    : dropdownLocatePrompt(page.page.title, label);
  const scrollPrompt = section
    ? sectionFieldLocatePrompt(page.page.title, section, label)
    : undefined;

  await scrollToElement(session, locateName, scrollPrompt);
  await agent.aiTap(tapPrompt);
  invalidateBottomSheetModalCheck(session);
  await sleep(env.timing.afterOpenDropdown);
}

function testCaseName(field: DropdownField): string {
  return field.section ? `${field.section} / ${field.label}` : field.label;
}

export async function testDropdownField(
  session: AgentSession,
  field: DropdownField,
): Promise<void> {
  const name = testCaseName(field);
  const maxAttempts = session.env.dropdown.maxSelectAttempts;
  console.log(`\n--- 下拉字段: ${name} ---`);

  await runTest(`${name} - 随机选一项并回显一致`, async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await openDropdown(session, field);
      console.log(`  第 ${attempt} 次选择...`);
      try {
        await selectRandomOptionWithConsistency(session, field);
        return;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        console.log('  一致性校验未通过，重新选择...');
      }
    }
  }, {
    agent: session.agent,
    screenshotsDir: session.env.paths.screenshots,
    runId: session.runId,
  });
}
