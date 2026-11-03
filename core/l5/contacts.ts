/** Relationship with you 从上到下：10 / 20 / 30 / 40 / 50 */
const RELATION_NAME_TO_CODE: Record<string, string> = {
  'father/mother': '10',
  'husband/wife': '20',
  'son/daughter': '30',
  friend: '40',
  'uncle/aunt': '50',
};

export type NormContact = { name: string; phone: string; relation: string };

export function last10Phone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(-10);
}

function relationCode(raw: unknown, nameHint?: unknown): string {
  const n = String(raw ?? '').trim();
  if (/^\d+$/.test(n) && n !== '') return n;
  const hint = String(nameHint ?? n).trim().toLowerCase().replace(/\s+/g, ' ');
  if (RELATION_NAME_TO_CODE[hint]) return RELATION_NAME_TO_CODE[hint];
  return hint;
}

function parseJsonish(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function unwrapList(v: unknown): unknown[] {
  const parsed = parseJsonish(v);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    for (const k of ['emergencyContactList', 'list', 'records', 'data']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
      const d = o.data as Record<string, unknown>;
      if (Array.isArray(d.emergencyContactList)) return d.emergencyContactList;
      if (Array.isArray(d.list)) return d.list;
    }
  }
  return [];
}

function fromRow(row: unknown): NormContact | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const name = String(o.contactName ?? o.contact_name ?? o.name ?? '').trim();
  const phone = last10Phone(o.contactPhone ?? o.contact_phone ?? o.mobile ?? o.phone);
  const relation = relationCode(o.relation, o.relationName ?? o.relation_name);
  if (!phone && !name) return null;
  return { name, phone, relation };
}

export function splitContactRows(
  raw: unknown,
): { submitted: NormContact[]; self: NormContact[] } {
  const submitted: NormContact[] = [];
  const self: NormContact[] = [];
  for (const row of unwrapList(raw)) {
    const c = fromRow(row);
    if (!c) continue;
    if (c.relation === '0' || c.relation === '') self.push(c);
    else submitted.push(c);
  }
  submitted.sort((a, b) => a.phone.localeCompare(b.phone) || a.name.localeCompare(b.name));
  return { submitted, self };
}

function sameSubmitted(a: NormContact[], b: NormContact[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    const phoneOk = x.phone === y.phone && x.phone.length >= 10;
    const nameOk = !x.name || !y.name || x.name === y.name;
    const relOk =
      !x.relation ||
      !y.relation ||
      x.relation === y.relation ||
      x.relation === y.relation.replace(/^0+/, '') ||
      y.relation === x.relation.replace(/^0+/, '');
    return phoneOk && nameOk && relOk;
  });
}

/**
 * 屏上紧急联系人与库表一致（不做写入 API）。
 * 库表会多一行 relation=0、contact_phone=登录手机号，不参与提交列表比对，但 SQL 侧必须有该行。
 */
export function contactsAligned(values: unknown[], loginPhone: string): boolean {
  const parts = values.map(splitContactRows);
  if (parts.length < 2) return true;
  if (parts.some((p) => p.submitted.length === 0)) return false;
  const first = parts[0].submitted;
  if (!parts.every((p) => sameSubmitted(first, p.submitted))) return false;

  const login = last10Phone(loginPhone);
  const withSelf = parts.filter((p) => p.self.length > 0);
  if (withSelf.length === 0) return false;
  return withSelf.every((p) => !login || p.self.some((s) => s.phone === login));
}
