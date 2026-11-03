export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isContentFilterError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('data_inspection_failed') ||
    msg.includes('inappropriate content') ||
    msg.includes('DataInspectionFailed')
  );
}

export function isAdbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('ADB error') || msg.includes('when calling shell');
}

export function shortenError(error: string, maxLen = 120): string {
  const firstLine = error.split('\n')[0].trim();
  return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen)}...` : firstLine;
}

export function calcPassRate(passed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((passed / total) * 1000) / 10;
}

export function fieldLocatePrompt(pageTitle: string, fieldLabel: string): string {
  return `The "${fieldLabel}" field row on ${pageTitle} page`;
}

export function dropdownLocatePrompt(pageTitle: string, fieldLabel: string): string {
  return `The "${fieldLabel}" dropdown row on ${pageTitle} page, gray clickable area with chevron (>) on the right`;
}

export function sectionFieldLocatePrompt(
  pageTitle: string,
  section: string,
  fieldLabel: string,
): string {
  return `The "${fieldLabel}" field row in the "${section}" section on ${pageTitle} page`;
}

export function sectionDropdownLocatePrompt(
  pageTitle: string,
  section: string,
  fieldLabel: string,
): string {
  return `The "${fieldLabel}" dropdown row in the "${section}" section on ${pageTitle} page, gray clickable area with chevron (>) on the right`;
}

export function contactFieldLocatePrompt(
  pageTitle: string,
  section: string,
  fieldLabel: string,
): string {
  return `The "${fieldLabel}" contact picker row in the "${section}" section on ${pageTitle} page, tap the right side arrow area to open native contacts`;
}

export function inputLocatePrompt(pageTitle: string, fieldLabel: string): string {
  return (
    `The "${fieldLabel}" text input field on the ${pageTitle} page. ` +
    `Tap only the text value area of this input — do NOT tap Gender, Date of Birth, ` +
    `or any row with an orange chevron (>)`
  );
}

export function randomOptionIndex(count = 3): number {
  return Math.floor(Math.random() * count) + 1;
}

export function optionOrdinal(index: number): string {
  return index === 1 ? 'st' : index === 2 ? 'nd' : 'rd';
}

export async function safeAiCall<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; contentFilter: boolean; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, contentFilter: isContentFilterError(err), error: err };
  }
}
