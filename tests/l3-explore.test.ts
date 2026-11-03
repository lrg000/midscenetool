import 'dotenv/config';
import { createAgentSession, connectSession } from '../core/ai-agent.js';
import { launchAndroidApp } from '../core/app-launch.js';
import { loadL5Config } from '../core/l5/config.js';
import { runL3Explore } from '../core/l5/explore.js';
import {
  loadPackageProfile,
  resolvePackageDataFile,
} from '../core/package-profile.js';
import { sleep } from '../core/utils.js';

/**
 * L3：只冷启 App，再按 config/l5.yaml explore 做有界视觉探索（不跑完整 A 面 YAML）。
 *
 *   $env:L3_PACKAGE = "t57"
 *   npm run test:l3:explore
 */
const cfg = loadL5Config();
const packageId =
  process.env.L3_PACKAGE?.trim() || cfg.explore?.packageId || 't57';

Promise.resolve(
  (async () => {
    const pkg = loadPackageProfile(packageId);
    const first = pkg.pages[0];
    if (!first) throw new Error(`包 ${packageId} 没有 pages`);
    const dataFile = resolvePackageDataFile(pkg.id, first.dataFile, pkg.sourcePackage);
    const session = await createAgentSession({
      pageId: first.id,
      dataFile,
      groupName: `L3 explore / ${pkg.name}`,
    });
    session.packageProfile = pkg;
    session.allowedActionDomains = pkg.actionDomains;
    await connectSession(session);
    await sleep(session.env.timing.pageReady);
    await launchAndroidApp(session, pkg.androidPackage, {
      skipLaunch:
        process.env.SKIP_LAUNCH === '1' || process.env.ASIDE_SKIP_LAUNCH === '1',
      softFailure: false,
    });
    await runL3Explore(session);
  })().catch((err) => {
    console.error('\nL3 探索异常:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }),
);
