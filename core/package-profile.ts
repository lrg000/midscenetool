import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  defaultActionDomainsForKind,
  type ActionDomain,
} from './actions/domains.js';

const ROOT = process.cwd();

export type PackageKind = 'standalone' | 'loan-shell' | 'loan-postlogin';

export interface PackagePageRef {
  /** 会话内页面 id（报告 / 日志用） */
  id: string;
  /** 相对 packages/{packageId}/ 的 YAML 路径 */
  dataFile: string;
}

export interface PackageProfile {
  id: string;
  name: string;
  description?: string;
  /**
   * 产品域：
   * - standalone：独立 App（Y 包、记账壳等），禁止 handoff 进 B 面
   * - loan-shell：贷款壳（含登录前），可配置 handoffFlow
   * - loan-postlogin：已登录贷前壳片段
   */
  kind: PackageKind;
  /** Android applicationId；配置后 A 面跑前可 launch */
  androidPackage?: string;
  /** 文案品牌名（Prompt 里可引用） */
  appLabel?: string;
  /**
   * YAML 所在目录名（默认等于 package id）。
   * 如 t42-postlogin 复用 packages/t42/ 时设 sourcePackage: t42
   */
  sourcePackage?: string;
  pages: PackagePageRef[];
  /**
   * A 面跑完后可选串联现有 B 面业务流 id（如 business-new-user）。
   * 仅 loan-shell / loan-postlogin 允许；standalone 禁止。
   */
  handoffFlow?: string | null;
  /**
   * 本包允许的 action 域（见 core/actions/domains.ts）。
   * 未配置时按 kind 默认：loan-* → common+loan；standalone → common。
   */
  actionDomains: ActionDomain[];
}

interface PackagesFile {
  packages: Record<
    string,
    Omit<PackageProfile, 'id' | 'kind' | 'actionDomains'> & {
      id?: string;
      kind?: PackageKind;
      actionDomains?: ActionDomain[];
      sourcePackage?: string;
    }
  >;
}

export function packagesRoot(): string {
  return join(ROOT, 'packages');
}

export function packageDir(packageId: string): string {
  return join(packagesRoot(), packageId);
}

/** 解析页面 YAML 相对项目根的路径（可用 sourcePackage 指向另一目录） */
export function resolvePackageDataFile(
  packageId: string,
  dataFile: string,
  sourcePackage?: string,
): string {
  const dirName = sourcePackage ?? packageId;
  return join('packages', dirName, dataFile).replace(/\\/g, '/');
}

/** 未写 kind 时的推断：T* = 贷款壳，Y* = 独立 App */
export function inferPackageKind(packageId: string): PackageKind {
  const id = packageId.trim().toLowerCase();
  if (id.includes('postlogin')) return 'loan-postlogin';
  if (id.startsWith('t')) return 'loan-shell';
  if (id.startsWith('y')) return 'standalone';
  return 'standalone';
}

function validateHandoff(pkg: PackageProfile): void {
  if (!pkg.handoffFlow) return;
  if (pkg.kind === 'standalone') {
    throw new Error(
      `包 ${pkg.id} 的 kind=standalone（独立业务），禁止配置 handoffFlow=${pkg.handoffFlow}。` +
        `只有 loan-shell / loan-postlogin 可交接进 B 面模版。`,
    );
  }
}

export function loadPackageProfile(packageId: string): PackageProfile {
  const configPath = join(ROOT, 'config', 'packages.yaml');
  if (!existsSync(configPath)) {
    throw new Error('缺少 config/packages.yaml（A 面包注册表）');
  }
  const file = parseYaml(readFileSync(configPath, 'utf-8')) as PackagesFile;
  const raw = file.packages?.[packageId];
  if (!raw) {
    throw new Error(`未找到 A 面包配置: ${packageId}（config/packages.yaml）`);
  }
  if (!raw.pages?.length) {
    throw new Error(`A 面包 ${packageId} 未配置 pages[]`);
  }

  const sourcePackage = raw.sourcePackage?.trim() || undefined;
  const filesDirName = sourcePackage ?? packageId;
  const dir = packageDir(filesDirName);
  if (!existsSync(dir)) {
    throw new Error(
      `A 面包目录不存在: packages/${filesDirName}` +
        (sourcePackage ? `（${packageId}.sourcePackage=${sourcePackage}）` : ''),
    );
  }

  for (const p of raw.pages) {
    const rel = resolvePackageDataFile(packageId, p.dataFile, sourcePackage);
    const full = join(ROOT, rel);
    if (!existsSync(full)) {
      throw new Error(`A 面页面 YAML 不存在: ${rel}`);
    }
  }

  const kind = raw.kind ?? inferPackageKind(packageId);
  const actionDomains =
    raw.actionDomains?.length ? raw.actionDomains : defaultActionDomainsForKind(kind);

  const profile: PackageProfile = {
    id: packageId,
    name: raw.name ?? packageId,
    description: raw.description,
    kind,
    androidPackage: raw.androidPackage,
    appLabel: raw.appLabel,
    sourcePackage,
    pages: raw.pages,
    handoffFlow: raw.handoffFlow ?? null,
    actionDomains,
  };

  validateHandoff(profile);
  return profile;
}

/** 加载全部包（供 androidPackage 反查、dashboard 分组） */
export function loadAllPackageProfiles(): PackageProfile[] {
  const configPath = join(ROOT, 'config', 'packages.yaml');
  if (!existsSync(configPath)) return [];
  const file = parseYaml(readFileSync(configPath, 'utf-8')) as PackagesFile;
  const ids = Object.keys(file.packages ?? {});
  return ids.map((id) => loadPackageProfile(id));
}

/** 环境变量 PACKAGE_PROFILE，未设置时返回 null */
export function resolvePackageIdFromEnv(fallback?: string): string | null {
  const fromEnv = process.env.PACKAGE_PROFILE?.trim();
  if (fromEnv) return fromEnv;
  return fallback ?? null;
}
