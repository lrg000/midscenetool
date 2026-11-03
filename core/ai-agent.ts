import 'dotenv/config';
import { join } from 'node:path';
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from '@midscene/android';
import { loadEnvironment, loadPageData, loadPageMeta, loadPageMetaRaw } from './config-loader.js';
import { loadPageDataRaw } from './credentials.js';
import { AiCache } from './ai-cache.js';
import { AiMetrics } from './ai-metrics.js';
import { wrapAgentWithMetrics } from './instrumented-agent.js';
import { ensureMidsceneRunDirs, resolveScreenshotsDir } from './paths.js';
import { setActiveRunContext } from './test-context.js';
import type { AgentSession } from './types.js';
import { patchAndroidScreenshot } from './android-screencap.js';

export interface CreateSessionOptions {
  pageId: string;
  runId?: string;
  accountProfile?: import('./account-profile.js').AccountProfile | null;
  /**
   * true：允许加载 pages.yaml 中 enabled:false 的页面（业务流多页串联）。
   * false/缺省：单页入口必须 enabled:true，否则抛错拦截。
   */
  allowDisabledPage?: boolean;
  /**
   * A 面扩展：直接指定 data YAML 路径（相对项目根），可不注册 pages.yaml。
   * 与 pageId 一起用于报告命名。
   */
  dataFile?: string;
  groupName?: string;
  /**
   * 指定 Android 设备 udid；缺省读 MIDSCENE_DEVICE_UDID，再回退到已连接的第一台。
   */
  deviceId?: string;
}

export async function createAgentSession(
  options: CreateSessionOptions,
): Promise<AgentSession & { cache: AiCache; metrics: AiMetrics }> {
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, '-');
  const runStartedAt = new Date();

  let meta;
  let page;
  if (options.dataFile) {
    const { loadPageDataFromFile } = await import('./config-loader.js');
    page = loadPageDataFromFile(options.dataFile);
    meta = {
      id: options.pageId,
      title: page.page.title,
      dataFile: options.dataFile,
      enabled: true,
      groupName: options.groupName ?? `A-side / ${options.pageId}`,
    };
  } else if (options.allowDisabledPage) {
    meta = loadPageMetaRaw(options.pageId);
    page = loadPageDataRaw(options.pageId);
  } else {
    meta = loadPageMeta(options.pageId);
    page = loadPageData(options.pageId);
  }
  const env = loadEnvironment();
  ensureMidsceneRunDirs(env);

  const devices = await getConnectedDevices();
  if (!devices.length) throw new Error('未检测到已连接的 Android 设备');

  const preferredUdid =
    options.deviceId?.trim() ||
    process.env.MIDSCENE_DEVICE_UDID?.trim() ||
    '';
  const matched = preferredUdid
    ? devices.find((d) => d.udid === preferredUdid)
    : undefined;
  if (preferredUdid && !matched) {
    const available = devices.map((d) => d.udid).join(', ');
    throw new Error(`未找到设备 ${preferredUdid}；当前已连接: ${available || '无'}`);
  }
  const deviceUdid = matched?.udid ?? devices[0].udid;
  const device = new AndroidDevice(deviceUdid);
  const deviceTag = deviceUdid.replace(/[^a-zA-Z0-9._-]/g, '_');
  const reportBase = `${meta.id}-${deviceTag}-${runId}`;
  // Midscene 定位缓存：id 必须跨 run 稳定；此前绑 runId 导致每次冷启动、cache/ 长期为空
  const locateCacheId = `${meta.id}-${deviceTag}`;
  const cacheDir = join(process.cwd(), env.paths.cache);
  const promptCacheDir = join(cacheDir, 'prompt');
  const rawAgent = new AndroidAgent(device, {
    testId: meta.id,
    groupName: meta.groupName,
    reportFileName: reportBase,
    aiActionContext: page.page.aiContext,
    replanningCycleLimit: env.agent.replanningCycleLimit,
    generateReport: env.agent.generateReport,
    cache: {
      id: locateCacheId,
      strategy: 'read-write',
      cacheDir,
    },
  });

  const cache = new AiCache(promptCacheDir);
  const metrics = new AiMetrics();
  const agent = wrapAgentWithMetrics(rawAgent, metrics);

  setActiveRunContext({
    agent,
    device,
    screenshotsDir: resolveScreenshotsDir(env),
    runId,
  });

  return {
    agent,
    device,
    page,
    meta,
    env,
    runId,
    runStartedAt,
    reportFilePath: null,
    cache,
    metrics,
    accountProfile: options.accountProfile ?? null,
    l5: { snapshots: [] },
  };
}

export async function connectSession(session: AgentSession): Promise<void> {
  await session.device.connect();
  patchAndroidScreenshot(session.device);
  if (session.page.page.isNative || session.page.page.skipNavigation) {
    return;
  }
  await session.agent.aiAct(session.page.page.navigationPrompt);
}
