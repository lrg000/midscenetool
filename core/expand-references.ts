import type {
  ContactField,
  DropdownField,
  FlowStep,
  PageDataConfig,
} from './types.js';

/**
 * 将 references 列表展开为 dropdowns / contacts / flow 步骤。
 * 再增加第 N 个联系人只需在 YAML 的 references 里加一项。
 */
export function expandReferenceSections(page: PageDataConfig): PageDataConfig {
  const refs = page.references;
  if (!refs?.length) return page;

  const d = page.referenceDefaults ?? {};
  const relationshipLabel = d.relationshipLabel ?? 'Relationship';
  const relationshipModalTitle = d.relationshipModalTitle ?? 'Relationship with you';
  const contactLabel = d.contactLabel ?? 'Full Name';
  const placeholder =
    d.placeholder ?? 'e.g. Rahul Kumar Sharma (avoid nicknames)';
  const mobilePlaceholder = d.mobilePlaceholder ?? 'e.g. 98115 43210';

  const sectionNames = refs.map((r) => r.section);
  const sectionSet = new Set(sectionNames);

  const dropdownsFromRefs: DropdownField[] = refs.map((r) => ({
    section: r.section,
    label: relationshipLabel,
    modalTitle: relationshipModalTitle,
  }));

  const contactsFromRefs: ContactField[] = refs.map((r, i) => ({
    section: r.section,
    label: contactLabel,
    placeholder,
    mobilePlaceholder,
    contactIndex: r.contactIndex ?? i,
  }));

  const refFlowSteps: FlowStep[] = [];
  for (const r of refs) {
    refFlowSteps.push({
      section: r.section,
      type: 'dropdown',
      label: relationshipLabel,
      optional: r.optional,
    });
    refFlowSteps.push({
      section: r.section,
      type: 'contact',
      label: contactLabel,
      optional: r.optional,
    });
  }

  const isRefStep = (s: FlowStep) =>
    (s.type === 'dropdown' || s.type === 'contact') && sectionSet.has(s.section);

  const kept = (page.flow ?? []).filter((s) => !isRefStep(s));
  const head: FlowStep[] = [];
  const tail: FlowStep[] = [];
  let pastHead = false;
  for (const s of kept) {
    if (!pastHead && s.section === 'Page') {
      head.push(s);
    } else {
      pastHead = true;
      tail.push(s);
    }
  }

  const requiredNames = refs.filter((r) => !r.optional).map((r) => r.section);
  const optionalNames = refs.filter((r) => r.optional).map((r) => r.section);
  const requiredQuoted = requiredNames.map((n) => `"${n}"`).join(', ');
  const optionalHint = optionalNames.length
    ? ` Optional sections such as ${optionalNames.map((n) => `"${n}"`).join(', ')} may appear further down after scrolling and are not required for this check.`
    : '';
  const fallbackQuoted = sectionNames.map((n) => `"${n}"`).join(', ');
  const defaultAssert = `The "${page.page.title}" page is visible with the page title in the header and at least the required section headers including ${requiredQuoted || fallbackQuoted}. Fields may already be filled or still show placeholders.${optionalHint}`;

  if (!head.some((s) => s.type === 'verify')) {
    head.unshift({
      section: 'Page',
      type: 'verify',
      label: `${page.page.title} 页面`,
      assertPrompt: defaultAssert,
    });
  } else {
    for (const s of head) {
      if (s.type !== 'verify') continue;
      if (
        !s.assertPrompt ||
        /Primary Reference|Secondary Reference|Third Reference/.test(s.assertPrompt)
      ) {
        s.assertPrompt = defaultAssert;
      }
    }
  }

  const otherDropdowns = (page.dropdowns ?? []).filter(
    (dd) =>
      !(dd.label === relationshipLabel && dd.section && sectionSet.has(dd.section)),
  );
  const otherContacts = (page.contacts ?? []).filter((c) => !sectionSet.has(c.section));

  const lastSection = sectionNames[sectionNames.length - 1];

  return {
    ...page,
    page: {
      ...page.page,
      bottomFields: page.page.bottomFields?.length
        ? page.page.bottomFields
        : [contactLabel, lastSection],
    },
    dropdowns: [...otherDropdowns, ...dropdownsFromRefs],
    contacts: [...otherContacts, ...contactsFromRefs],
    flow: [...head, ...refFlowSteps, ...tail],
  };
}
