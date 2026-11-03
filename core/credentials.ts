import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PageDataConfig } from './types.js';
import { loadPageMetaRaw } from './config-loader.js';
import { expandReferenceSections } from './expand-references.js';
import { resolveAccountProfile, type AccountProfile } from './account-profile.js';

const ROOT = process.cwd();

export function getCredentials(profile?: AccountProfile | null) {
  const p = profile ?? resolveAccountProfile();
  return {
    mobile: p?.mobile ?? process.env.TEST_MOBILE ?? '9110001265',
    otp: p?.otp ?? process.env.TEST_OTP ?? '123456',
  };
}

export function loadPageDataRaw(pageId: string): PageDataConfig {
  const meta = loadPageMetaRaw(pageId);
  const raw = readFileSync(join(ROOT, meta.dataFile), 'utf-8');
  return expandReferenceSections(parseYaml(raw) as PageDataConfig);
}

export function switchPageSession(
  session: import('./types.js').AgentSession,
  pageId: string,
): void {
  session.meta = loadPageMetaRaw(pageId);
  session.page = loadPageDataRaw(pageId);
}
