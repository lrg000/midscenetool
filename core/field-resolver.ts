export function getDropdownField(
  page: import('./types.js').PageDataConfig,
  label: string,
  flowSection?: string,
) {
  const matches = page.dropdowns.filter((f) => f.label === label);
  if (matches.length === 0) {
    const hint = flowSection ? `${flowSection} / ${label}` : label;
    throw new Error(`未找到下拉字段配置: ${hint}`);
  }
  if (matches.length === 1) return matches[0];

  // 同 label 多份（如 Reference Contacts 两个 Relationship）须用 section 区分
  if (!flowSection) {
    throw new Error(`下拉字段 "${label}" 存在 ${matches.length} 份配置，flow 步骤须带 section`);
  }
  const field = matches.find((f) => f.section === flowSection);
  if (!field) {
    throw new Error(`未找到下拉字段配置: ${flowSection} / ${label}`);
  }
  return field;
}

export function getInputField(
  page: import('./types.js').PageDataConfig,
  label: string,
  flowSection?: string,
) {
  const matches = page.inputs.filter((f) => f.label === label);
  if (matches.length === 0) {
    throw new Error(`未找到输入框配置: ${label}`);
  }
  if (matches.length === 1) return matches[0];

  if (!flowSection) {
    throw new Error(`输入框 "${label}" 存在 ${matches.length} 份配置，flow 步骤须带 section`);
  }
  const field = matches.find((f) => f.section === flowSection);
  if (!field) {
    throw new Error(`未找到输入框配置: ${flowSection} / ${label}`);
  }
  return field;
}

export function getContactField(
  page: import('./types.js').PageDataConfig,
  section: string,
  label: string,
) {
  const field = page.contacts?.find((f) => f.section === section && f.label === label);
  if (!field) throw new Error(`未找到通讯录字段配置: ${section} / ${label}`);
  return field;
}

export function getCheckboxField(
  page: import('./types.js').PageDataConfig,
  label: string,
) {
  const field = page.checkboxes?.find((f) => f.label === label);
  if (!field) throw new Error(`未找到勾选框配置: ${label}`);
  return field;
}
