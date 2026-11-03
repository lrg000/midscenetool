import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadPageDataFromFile } from './config-loader.js';
import {
  loadAllPackageProfiles,
  resolvePackageDataFile,
  type PackagePageRef,
  type PackageProfile,
} from './package-profile.js';
import type { AgentSession, PageMeta } from './types.js';

export type PreloginRole = 'bootstrap' | 'login';

function pageMatchesRole(page: PackagePageRef, role: PreloginRole): boolean {
  const id = page.id.toLowerCase();
  const file = page.dataFile.replace(/\\/g, '/').toLowerCase();
  if (role === 'bootstrap') {
    return id.includes('bootstrap') || file.endsWith('/bootstrap.yaml') || file.endsWith('bootstrap.yaml');
  }
  return (
    (id.includes('login') && !id.includes('postlogin')) ||
    file.endsWith('/login.yaml') ||
    file.endsWith('login.yaml')
  );
}

/**
 * 按 Android applicationId 找「可提供登录前页」的包配置。
 * 优先 loan-shell，其次带 login/bootstrap 页的其它 kind；跳过 uninstall 专项。
 */
export function findPackageForAndroidPackage(
  androidPackage: string | undefined | null,
): PackageProfile | null {
  const pkgName = androidPackage?.trim();
  if (!pkgName) return null;

  const all = loadAllPackageProfiles();
  const matched = all.filter(
    (p) => p.androidPackage === pkgName && !p.id.includes('uninstall'),
  );
  if (!matched.length) return null;

  const shell = matched.find((p) => p.kind === 'loan-shell');
  if (shell) return shell;

  const withLogin = matched.find((p) =>
    p.pages.some((pg) => pageMatchesRole(pg, 'login') || pageMatchesRole(pg, 'bootstrap')),
  );
  if (withLogin) return withLogin;

  return matched[0] ?? null;
}

export function findPreloginPage(
  pkg: PackageProfile,
  role: PreloginRole,
): PackagePageRef | null {
  return pkg.pages.find((p) => pageMatchesRole(p, role)) ?? null;
}

export function switchSessionToPackagePage(
  session: AgentSession,
  pkg: PackageProfile,
  pageRef: PackagePageRef,
): void {
  const dataFile = resolvePackageDataFile(pkg.id, pageRef.dataFile, pkg.sourcePackage);
  const page = loadPageDataFromFile(dataFile);
  const meta: PageMeta = {
    id: pageRef.id,
    title: page.page.title,
    dataFile,
    enabled: true,
    groupName: `A-side / ${pkg.name}`,
  };
  session.page = page;
  session.meta = meta;
}

/**
 * B 面全流程登录前：优先用当前 androidPackage 对应包内 bootstrap/login YAML；
 * 找不到则回退共享 data/app-bootstrap、data/login（贷款模版默认路径）。
 */
export function resolvePreloginSource(
  androidPackage: string | undefined | null,
  role: PreloginRole,
): {
  mode: 'package' | 'shared';
  packageProfile?: PackageProfile;
  pageRef?: PackagePageRef;
  sharedPageId: string;
} {
  const sharedPageId = role === 'bootstrap' ? 'app-bootstrap' : 'login';
  const pkg = findPackageForAndroidPackage(androidPackage);
  if (!pkg) {
    return { mode: 'shared', sharedPageId };
  }
  const pageRef = findPreloginPage(pkg, role);
  if (!pageRef) {
    return { mode: 'shared', packageProfile: pkg, sharedPageId };
  }
  return { mode: 'package', packageProfile: pkg, pageRef, sharedPageId };
}

/** 校验共享页 YAML 仍存在（回退路径） */
export function assertSharedPreloginExists(sharedPageId: string): void {
  const pagesPath = join(process.cwd(), 'config', 'pages.yaml');
  if (!existsSync(pagesPath)) {
    throw new Error('缺少 config/pages.yaml');
  }
  const pages = parseYaml(readFileSync(pagesPath, 'utf-8')) as {
    pages?: Record<string, { dataFile?: string }>;
  };
  const meta = pages.pages?.[sharedPageId];
  if (!meta?.dataFile) {
    throw new Error(`共享登录前页面未注册: ${sharedPageId}（config/pages.yaml）`);
  }
  const full = join(process.cwd(), meta.dataFile);
  if (!existsSync(full)) {
    throw new Error(`共享登录前 YAML 不存在: ${meta.dataFile}`);
  }
}
