import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { EnvironmentConfig, PageDataConfig, PageMeta } from './types.js';
import { expandReferenceSections } from './expand-references.js';

const ROOT = process.cwd();

function loadYamlFile<T>(relativePath: string): T {
  const fullPath = join(ROOT, relativePath);
  const raw = readFileSync(fullPath, 'utf-8');
  return parseYaml(raw) as T;
}

function loadAndExpandPageData(dataFile: string): PageDataConfig {
  const raw = loadYamlFile<PageDataConfig>(dataFile);
  return expandReferenceSections(raw);
}

export function loadEnvironment(): EnvironmentConfig {
  return loadYamlFile<EnvironmentConfig>('config/environment.yaml');
}

export function loadPageMeta(pageId: string): PageMeta {
  const meta = loadPageMetaRaw(pageId);
  if (!meta.enabled) {
    throw new Error(
      `页面 ${pageId} 未启用（config/pages.yaml 中 enabled: false）。` +
        `单页测试请先改为 enabled: true；业务流可继续通过 allowDisabledPage 加载。`,
    );
  }
  return meta;
}

export function loadPageMetaRaw(pageId: string): PageMeta {
  const pagesConfig = loadYamlFile<{ pages: Record<string, PageMeta> }>('config/pages.yaml');
  const meta = pagesConfig.pages[pageId];
  if (!meta) throw new Error(`未找到页面配置: ${pageId}（config/pages.yaml）`);
  return meta;
}

/** 直接按路径加载页面 YAML（A 面包页面可不注册到 pages.yaml） */
export function loadPageDataFromFile(dataFile: string): PageDataConfig {
  return loadAndExpandPageData(dataFile);
}

export function loadPageData(pageId: string): PageDataConfig {
  const meta = loadPageMeta(pageId);
  return loadAndExpandPageData(meta.dataFile);
}

import type { AccountProfile } from './account-profile.js';
import type { HomeState } from './home-router.js';

export interface FlowConfig {
  description?: string;
  pages: string[];
  /** 登录前执行的 bootstrap 页（默认 app-bootstrap，设 null 跳过） */
  bootstrap?: string | null;
  /** 本流程不含登录（如 kyc-full）；KYC 五步按当前屏识别，设备需已在五页之一 */
  skipLogin?: boolean;
  /** 登录后只检测首页主按钮，不点击（如 home 冒烟） */
  skipPostLoginTap?: boolean;
  /** 登录后、进入子流程前必须点击的首页按钮（对齐 Appium _click_home_target） */
  postLoginTap?: HomeState;
  /** 覆盖 environment.yaml，本流程冷启要打开的 Android 包名 */
  androidPackage?: string;
}

export function loadFlowConfig(flowId: string): FlowConfig {
  const flows = loadYamlFile<{ flows: Record<string, FlowConfig> }>('config/flows.yaml');
  const flow = flows.flows[flowId];
  if (!flow) throw new Error(`未找到流程配置: ${flowId}（config/flows.yaml）`);
  return flow;
}

export function loadFlowPageIds(flowId: string): string[] {
  return loadFlowConfig(flowId).pages;
}

export { getDropdownField, getInputField, getContactField, getCheckboxField } from './field-resolver.js';
