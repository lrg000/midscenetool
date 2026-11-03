import type { AgentSession, EnvironmentConfig } from './types.js';
import { sleep } from './utils.js';

/**
 * 解析 B 面全流程要启动的 Android applicationId。
 * 优先级：ANDROID_PACKAGE 环境变量 > 调用参数 > flow.androidPackage > environment.yaml app.androidPackage
 */
export function resolveBusinessAndroidPackage(options: {
  env: EnvironmentConfig;
  flowPackage?: string | null;
  optionPackage?: string | null;
}): string | undefined {
  const fromEnv = process.env.ANDROID_PACKAGE?.trim();
  if (fromEnv) return fromEnv;
  const fromOpt = options.optionPackage?.trim();
  if (fromOpt) return fromOpt;
  const fromFlow = options.flowPackage?.trim();
  if (fromFlow) return fromFlow;
  const fromYaml = options.env.app?.androidPackage?.trim();
  return fromYaml || undefined;
}

function assertSafeAndroidPackage(pkg: string): string {
  const id = pkg.trim();
  if (!/^[a-zA-Z0-9._]+$/.test(id)) {
    throw new Error(`非法 Android 包名: ${pkg}`);
  }
  return id;
}

/** `pm clear`：清该包缓存 + 内部存储（等同设置里「清除数据」），应用会被停掉。 */
export async function clearAndroidAppData(
  session: AgentSession,
  androidPackage: string,
): Promise<void> {
  const pkg = assertSafeAndroidPackage(androidPackage);
  console.log(`  清除 App 缓存/存储: ${pkg}`);
  const adb = await session.device.getAdb();
  try {
    await adb.shell(`am force-stop ${pkg}`);
  } catch {
    // 进程本就没在跑时忽略
  }
  const out = String(await adb.shell(`pm clear ${pkg}`)).trim();
  if (!/success/i.test(out)) {
    const retry = String(await adb.shell(`pm clear --user 0 ${pkg}`)).trim();
    if (!/success/i.test(retry)) {
      throw new Error(`清除 ${pkg} 数据失败: ${out || retry || '无输出'}`);
    }
  }
  await sleep(800);
}

export async function launchAndroidApp(
  session: AgentSession,
  androidPackage: string | undefined | null,
  options?: { skipLaunch?: boolean; softFailure?: boolean; clearStorage?: boolean },
): Promise<void> {
  if (options?.skipLaunch) {
    console.log('  ⏭️ 跳过启动 App（skipLaunch）');
    return;
  }
  const pkg = androidPackage?.trim();
  if (!pkg) return;

  if (options?.clearStorage) {
    await clearAndroidAppData(session, pkg);
  }

  console.log(`  启动 App: ${pkg}`);
  try {
    await session.agent.launch(pkg);
    await sleep(session.env.timing.pageReady ?? 1500);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const message =
      `启动 App 失败（${pkg}）: ${detail}。请确认设备已安装该包，或设置 SKIP_LAUNCH=1 后手动打开。`;
    if (options?.softFailure) {
      console.log(`  ${message}`);
      return;
    }
    throw new Error(message);
  }
}
