import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { inferPackageKind, type PackageKind } from '../core/package-profile.js';
import { listAgentsForUi, type AgentUiItem } from './agents.js';

export interface CatalogItem {
  id: string;
  kind: 'page' | 'flow' | 'aside' | 'explore';
  /** 包产品域（仅 aside）：standalone / loan-shell / loan-postlogin */
  packageKind?: PackageKind;
  /** 业务流形态：全流程会冷启 App；分段不含登录。单页流不进目录（与 B 面单页重复） */
  runMode?: 'segment' | 'full-flow';
  title: string;
  description: string;
  group: string;
  npmScript?: string;
}

export interface LaunchAppOption {
  id: string;
  name: string;
  androidPackage: string;
}

export interface AccountOption {
  id: string;
  description: string;
  mobile: string;
  otp: string;
  /** 该账号默认对应的全流程 id */
  flow?: string;
}

export interface CatalogResponse {
  items: CatalogItem[];
  /** environment.yaml app.androidPackage，全流程包名输入的默认值 */
  defaultAndroidPackage: string;
  /** 已登记贷款壳，供全流程包名候选；仍允许填未登记的自定义包名 */
  launchApps: LaunchAppOption[];
  /** B 面全流程账号预设；手机号和 OTP 仍可改成未登记的值 */
  accounts: AccountOption[];
  /** environment.yaml credentials，自定义账号时的初始值 */
  defaultMobile: string;
  defaultOtp: string;
  defaultAgentId: string;
  agents: AgentUiItem[];
}

const ROOT = process.cwd();

function loadYaml<T>(relativePath: string): T {
  return parseYaml(readFileSync(join(ROOT, relativePath), 'utf-8')) as T;
}

function asideGroup(kind: PackageKind): string {
  switch (kind) {
    case 'loan-shell':
      return '贷款壳（可交接 B 面）';
    case 'loan-postlogin':
      return '贷款壳 · 登录后';
    case 'standalone':
    default:
      return '独立 App（不进 B 面）';
  }
}

export function loadCatalog(): CatalogItem[] {
  const items: CatalogItem[] = [];

  const pageScripts = new Set([
    'basic-info',
    'reference-contacts',
    'bank-info',
    'kyc-aadhaar',
    'kyc-liveness',
    'repay',
  ]);

  const pages = loadYaml<{ pages: Record<string, { id: string; title: string; groupName?: string; enabled?: boolean }> }>(
    'config/pages.yaml',
  );
  for (const page of Object.values(pages.pages)) {
    if (page.enabled === false) continue;
    items.push({
      id: page.id,
      kind: 'page',
      title: page.title,
      description: `单页测试 · ${page.id}`,
      group: page.groupName ?? 'B 面模版 · 单页',
      npmScript: pageScripts.has(page.id) ? `test:${page.id}` : undefined,
    });
  }

  const pageIds = new Set(items.filter((item) => item.kind === 'page').map((item) => item.id));
  const flows = loadYaml<{
    flows: Record<string, { description?: string; pages?: string[]; bootstrap?: string | null; skipLogin?: boolean }>;
  }>('config/flows.yaml');
  for (const [id, flow] of Object.entries(flows.flows)) {
    const runMode = classifyFlow(id, flow);
    // 【单页】流程与 pages.yaml 的 B 面单页是同一条用例，不再在「B 面流程」里重复列出
    if (runMode === 'single-page') {
      const only = flow.pages?.[0];
      if (only && pageIds.has(only)) continue;
    }
    items.push({
      id,
      kind: 'flow',
      runMode: runMode === 'full-flow' ? 'full-flow' : 'segment',
      title: id,
      description: flow.description ?? `业务流 · ${id}`,
      group: runMode === 'full-flow' ? 'B 面模版 · 全流程' : 'B 面模版 · 分段',
      npmScript:
        id === 'kyc-full'
          ? 'test:kyc-full'
          : id === 'business-apply-only'
            ? 'test:business-apply'
            : id.startsWith('business-')
              ? `test:${id}`
              : undefined,
    });
  }

  const packages = loadYaml<{
    packages: Record<
      string,
      { name: string; description?: string; kind?: PackageKind }
    >;
  }>('config/packages.yaml');
  for (const [id, pkg] of Object.entries(packages.packages)) {
    const packageKind = pkg.kind ?? inferPackageKind(id);
    items.push({
      id,
      kind: 'aside',
      packageKind,
      title: pkg.name,
      description: (pkg.description ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
      group: asideGroup(packageKind),
      npmScript: `test:aside:${id}`,
    });
  }

  items.push({
    id: 'l3-explore',
    kind: 'explore',
    title: 'L3 AI 探索',
    description: '冷启 config/l5.yaml explore.packageId 后有界点击；禁点列表与步数只改该配置。',
    group: 'L3 / L5',
    npmScript: 'test:l3:explore',
  });

  return items;
}

function classifyFlow(
  id: string,
  flow: { pages?: string[]; bootstrap?: string | null; skipLogin?: boolean },
): 'single-page' | 'segment' | 'full-flow' {
  if (id === 'business-auto' || id.startsWith('business-')) return 'full-flow';
  const pages = flow.pages ?? [];
  if (pages.length <= 1) return 'single-page';
  if (flow.skipLogin === true || flow.bootstrap === null) return 'segment';
  if (pages.length <= 2) return 'segment';
  return 'full-flow';
}

export function loadCatalogResponse(): CatalogResponse {
  const env = loadYaml<{
    app?: { androidPackage?: string };
    credentials?: { mobile?: string; otp?: string };
  }>('config/environment.yaml');
  const packages = loadYaml<{
    packages: Record<string, { name?: string; kind?: PackageKind; androidPackage?: string }>;
  }>('config/packages.yaml');

  const seen = new Set<string>();
  const launchApps: LaunchAppOption[] = [];
  for (const [id, pkg] of Object.entries(packages.packages)) {
    const kind = pkg.kind ?? inferPackageKind(id);
    const androidPackage = pkg.androidPackage?.trim();
    if (kind !== 'loan-shell' || !androidPackage) continue;
    if (id.includes('postlogin') || id.includes('uninstall')) continue;
    if (seen.has(androidPackage)) continue;
    seen.add(androidPackage);
    launchApps.push({
      id,
      name: pkg.name?.trim() || id,
      androidPackage,
    });
  }

  const accountFile = loadYaml<{
    accounts?: Record<string, { description?: string; mobile?: string; otp?: string; flow?: string }>;
  }>('config/accounts.yaml');
  const accounts: AccountOption[] = [];
  for (const [id, account] of Object.entries(accountFile.accounts ?? {})) {
    const flow = account.flow?.trim();
    if (!flow?.startsWith('business-')) continue;
    const mobile = String(account.mobile ?? '').trim();
    const otp = String(account.otp ?? '').trim();
    if (!mobile || !otp) continue;
    accounts.push({
      id,
      description: (account.description ?? '').trim(),
      mobile,
      otp,
      flow,
    });
  }

  const agentCatalog = listAgentsForUi();
  return {
    items: loadCatalog(),
    defaultAndroidPackage: env.app?.androidPackage?.trim() ?? '',
    launchApps,
    accounts,
    defaultMobile: String(env.credentials?.mobile ?? '').trim(),
    defaultOtp: String(env.credentials?.otp ?? '').trim(),
    defaultAgentId: agentCatalog.defaultId,
    agents: agentCatalog.agents,
  };
}

export function findCatalogItem(kind: string, id: string): CatalogItem | undefined {
  return loadCatalog().find((item) => item.kind === kind && item.id === id);
}
