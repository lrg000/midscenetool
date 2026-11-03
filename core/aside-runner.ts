import { createAgentSession, connectSession } from './ai-agent.js';
import { loadPageDataFromFile } from './config-loader.js';
import { runBusinessFlow } from './business-runner.js';
import { executePageFlow } from './page-executor.js';
import { clearResults } from './test-context.js';
import { finalizeRun } from '../reports/report-generator.js';
import {
  loadPackageProfile,
  resolvePackageDataFile,
  type PackagePageRef,
  type PackageProfile,
} from './package-profile.js';
import type { AgentSession, PageMeta } from './types.js';
import { launchAndroidApp } from './app-launch.js';
import { sleep } from './utils.js';

export interface AsideRunOptions {
  runId?: string;
  /** 从 pages 数组第几项开始（0-based） */
  startPageIndex?: number;
  /** 为 true 且 package.handoffFlow 有值时，A 面结束后跑 B 面业务流 */
  runHandoff?: boolean;
  /** 跳过 androidPackage launch */
  skipLaunch?: boolean;
  /** 指定 Android 设备 udid（多设备并行时传入） */
  deviceId?: string;
}

function metaForAsidePage(
  pkg: PackageProfile,
  pageRef: PackagePageRef,
  dataFile: string,
  pageTitle: string,
): PageMeta {
  return {
    id: pageRef.id,
    title: pageTitle,
    dataFile,
    enabled: true,
    groupName: `A-side / ${pkg.name}`,
  };
}

function switchAsidePage(session: AgentSession, pkg: PackageProfile, pageRef: PackagePageRef): void {
  const dataFile = resolvePackageDataFile(pkg.id, pageRef.dataFile, pkg.sourcePackage);
  const page = loadPageDataFromFile(dataFile);
  session.page = page;
  session.meta = metaForAsidePage(pkg, pageRef, dataFile, page.page.title);
}

async function launchPackageIfNeeded(
  session: AgentSession,
  pkg: PackageProfile,
  skipLaunch?: boolean,
): Promise<void> {
  await launchAndroidApp(session, pkg.androidPackage, { skipLaunch, softFailure: true });
}

/**
 * 跑某一 Android 包的 A 面规范化用例。
 * 不改动 B 面 H5 页面 YAML / business-* 流程；可选 handoff 再进 B 面。
 */
export async function runAsidePackage(
  packageId: string,
  options: AsideRunOptions = {},
): Promise<{ session: AgentSession; runId: string }> {
  const pkg = loadPackageProfile(packageId);
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, '-');
  const start = Math.max(0, options.startPageIndex ?? 0);
  const pages = pkg.pages.slice(start);
  if (!pages.length) {
    throw new Error(`A 面包 ${packageId} 无可用 pages（startPageIndex=${start}）`);
  }

  clearResults();
  console.log(`\n========== A 面测试包: ${pkg.name}（${pkg.id}） ==========`);
  if (pkg.description) console.log(`  ${pkg.description}`);

  const firstFile = resolvePackageDataFile(pkg.id, pages[0].dataFile, pkg.sourcePackage);
  const session = await createAgentSession({
    pageId: pages[0].id,
    dataFile: firstFile,
    groupName: `A-side / ${pkg.name}`,
    runId,
    deviceId: options.deviceId,
  });
  session.packageProfile = pkg;
  session.allowedActionDomains = pkg.actionDomains;

  try {
    await connectSession(session);
    await sleep(session.env.timing.pageReady);
    await launchPackageIfNeeded(session, pkg, options.skipLaunch);

    for (let i = 0; i < pages.length; i++) {
      const pageRef = pages[i];
      switchAsidePage(session, pkg, pageRef);
      await executePageFlow(session, { pageIndex: i + 1, pageTotal: pages.length });
    }

    session.reportFilePath = session.agent.reportFile ?? null;
    finalizeRun(session);
    console.log(`\n✓ A 面包 ${pkg.id}（kind=${pkg.kind}）执行完成`);
  } catch (err) {
    session.reportFilePath = session.agent.reportFile ?? null;
    finalizeRun(session, err instanceof Error ? err.message : String(err));
    throw err;
  }

  if (options.runHandoff && pkg.handoffFlow) {
    if (pkg.kind === 'standalone') {
      throw new Error(
        `包 ${pkg.id} 为 standalone，禁止 A→B handoff（handoffFlow=${pkg.handoffFlow}）`,
      );
    }
    console.log(`\n========== A→B 交接: ${pkg.handoffFlow} ==========`);
    await runBusinessFlow(pkg.handoffFlow, {
      runId: `${runId}-handoff`,
      skipBootstrap: true,
      skipLogin: true,
      androidPackage: pkg.androidPackage,
    });
  } else if (options.runHandoff && !pkg.handoffFlow) {
    console.log('  未配置 handoffFlow，跳过 B 面交接');
  }

  return { session, runId };
}
