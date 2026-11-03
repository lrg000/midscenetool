import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { HomeState } from './home-router.js';

export interface AccountProfile {
  description?: string;
  mobile: string;
  otp: string;
  expectedHome?: HomeState;
  flow?: string;
  /** 为 true 时不自动点击 Next/Apply/Go to repay（单页人工导航场景） */
  skipPostLoginTap?: boolean;
}

const ROOT = process.cwd();

function loadAccountsConfig(): { accounts: Record<string, AccountProfile> } {
  const raw = readFileSync(join(ROOT, 'config/accounts.yaml'), 'utf-8');
  return parseYaml(raw) as { accounts: Record<string, AccountProfile> };
}

/** 解析账号：ACCOUNT_PROFILE 环境变量 > 参数 > null */
export function resolveAccountProfile(name?: string): AccountProfile | null {
  const profileName = name ?? process.env.ACCOUNT_PROFILE;
  if (!profileName) return null;

  const config = loadAccountsConfig();
  const profile = config.accounts[profileName];
  if (!profile) {
    throw new Error(`未找到账号配置: ${profileName}（config/accounts.yaml）`);
  }
  console.log(`\n>>> 使用账号配置: ${profileName}${profile.description ? ` — ${profile.description}` : ''}\n`);
  return profile;
}

export function listAccountProfiles(): string[] {
  return Object.keys(loadAccountsConfig().accounts);
}
