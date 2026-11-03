import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface AgentPreset {
  id: string;
  label: string;
  description: string;
  fromEnv: boolean;
  baseUrl?: string;
  modelName?: string;
  modelFamily?: string;
  apiKeyEnv: string[];
  extraEnv?: Record<string, string>;
}

export interface AgentRunOverride {
  baseUrl?: string;
  modelName?: string;
  modelFamily?: string;
  apiKey?: string;
}

export interface AgentUiItem {
  id: string;
  label: string;
  description: string;
  fromEnv: boolean;
  configured: boolean;
  modelName: string;
  modelFamily: string;
  baseUrl: string;
  apiKeySet: boolean;
  apiKeyHint: string;
}

interface AgentsFile {
  default?: string;
  agents?: Record<
    string,
    {
      label?: string;
      description?: string;
      fromEnv?: boolean;
      baseUrl?: string;
      modelName?: string;
      modelFamily?: string;
      apiKeyEnv?: string | string[];
      extraEnv?: Record<string, string>;
    }
  >;
}

interface LocalFile {
  overrides?: Record<string, AgentRunOverride>;
}

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'config', 'agents.yaml');
const LOCAL_PATH = join(ROOT, 'config', 'agents.local.yaml');

function envTrim(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = envTrim(name);
    if (value) return value;
  }
  return '';
}

function maskKey(key: string): string {
  const value = key.trim();
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function loadAgentsFile(): AgentsFile {
  if (!existsSync(CONFIG_PATH)) return { default: 'bailian', agents: {} };
  return parseYaml(readFileSync(CONFIG_PATH, 'utf-8')) as AgentsFile;
}

function loadLocalFile(): LocalFile {
  if (!existsSync(LOCAL_PATH)) return { overrides: {} };
  try {
    return (parseYaml(readFileSync(LOCAL_PATH, 'utf-8')) as LocalFile) ?? { overrides: {} };
  } catch {
    return { overrides: {} };
  }
}

function localOverride(id: string): AgentRunOverride {
  return loadLocalFile().overrides?.[id] ?? {};
}

function builtinPresets(): AgentPreset[] {
  return [
    {
      id: 'bailian',
      label: '阿里百炼',
      description: '默认。使用项目 .env 的 MIDSCENE_MODEL_*，可在控制台改网关/模型/密钥。',
      fromEnv: true,
      apiKeyEnv: ['MIDSCENE_MODEL_API_KEY'],
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      description: 'OpenAI 官方接口。可在控制台填写密钥和模型。',
      fromEnv: false,
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      modelFamily: 'gpt-5',
      apiKeyEnv: ['OPENAI_API_KEY', 'MIDSCENE_CHATGPT_API_KEY'],
    },
    {
      id: 'claude',
      label: 'Claude',
      description: 'Anthropic Claude（OpenAI 兼容网关）。可在控制台填写密钥和模型。',
      fromEnv: false,
      baseUrl: 'https://api.anthropic.com/v1',
      modelName: 'claude-sonnet-4-5',
      modelFamily: 'gpt-5',
      apiKeyEnv: ['ANTHROPIC_API_KEY', 'MIDSCENE_CLAUDE_API_KEY', 'OPENROUTER_API_KEY'],
      extraEnv: {
        MIDSCENE_MODEL_INIT_CONFIG_JSON:
          '{"defaultHeaders":{"anthropic-version":"2023-06-01"}}',
      },
    },
  ];
}

export function loadAgentPresets(): AgentPreset[] {
  const file = loadAgentsFile();
  const builtins = builtinPresets();
  const byId = new Map(builtins.map((item) => [item.id, item]));
  for (const [id, raw] of Object.entries(file.agents ?? {})) {
    const apiKeyEnv = Array.isArray(raw.apiKeyEnv)
      ? raw.apiKeyEnv
      : raw.apiKeyEnv
        ? [raw.apiKeyEnv]
        : byId.get(id)?.apiKeyEnv ?? [];
    byId.set(id, {
      id,
      label: raw.label?.trim() || id,
      description: (raw.description ?? '').trim(),
      fromEnv: raw.fromEnv === true,
      baseUrl: raw.baseUrl?.trim(),
      modelName: raw.modelName?.trim(),
      modelFamily: raw.modelFamily?.trim(),
      apiKeyEnv,
      extraEnv: raw.extraEnv,
    });
  }
  return [...byId.values()];
}

export function defaultAgentId(): string {
  const file = loadAgentsFile();
  const id = file.default?.trim() || 'bailian';
  const presets = loadAgentPresets();
  return presets.some((item) => item.id === id) ? id : 'bailian';
}

export function findAgentPreset(id: string | undefined): AgentPreset {
  const presets = loadAgentPresets();
  const wanted = (id ?? '').trim() || defaultAgentId();
  const found = presets.find((item) => item.id === wanted);
  if (!found) throw new Error(`未找到视觉 Agent 预设: ${wanted}`);
  return found;
}

function overlayNames(preset: AgentPreset): { baseUrl: string[]; modelName: string[]; modelFamily: string[] } {
  const prefix = preset.id.toUpperCase();
  return {
    baseUrl: [`MIDSCENE_${prefix}_BASE_URL`],
    modelName: [`MIDSCENE_${prefix}_MODEL`],
    modelFamily: [`MIDSCENE_${prefix}_FAMILY`],
  };
}

function resolvedModel(preset: AgentPreset, inline?: AgentRunOverride): {
  baseUrl: string;
  modelName: string;
  modelFamily: string;
  apiKey: string;
} {
  const local = localOverride(preset.id);
  const names = overlayNames(preset);
  const envModel = preset.fromEnv
    ? {
        baseUrl: envTrim('MIDSCENE_MODEL_BASE_URL'),
        modelName: envTrim('MIDSCENE_MODEL_NAME'),
        modelFamily: envTrim('MIDSCENE_MODEL_FAMILY'),
        apiKey: envTrim('MIDSCENE_MODEL_API_KEY'),
      }
    : {
        baseUrl: firstEnv(names.baseUrl) || preset.baseUrl || '',
        modelName: firstEnv(names.modelName) || preset.modelName || '',
        modelFamily: firstEnv(names.modelFamily) || preset.modelFamily || '',
        apiKey: firstEnv(preset.apiKeyEnv),
      };

  return {
    baseUrl: inline?.baseUrl?.trim() || local.baseUrl?.trim() || envModel.baseUrl,
    modelName: inline?.modelName?.trim() || local.modelName?.trim() || envModel.modelName,
    modelFamily: inline?.modelFamily?.trim() || local.modelFamily?.trim() || envModel.modelFamily,
    apiKey: inline?.apiKey?.trim() || local.apiKey?.trim() || envModel.apiKey,
  };
}

export function isAgentConfigured(preset: AgentPreset): boolean {
  return Boolean(resolvedModel(preset).apiKey);
}

export function listAgentsForUi(): { defaultId: string; agents: AgentUiItem[] } {
  return {
    defaultId: defaultAgentId(),
    agents: loadAgentPresets().map((preset) => {
      const model = resolvedModel(preset);
      return {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        fromEnv: preset.fromEnv,
        configured: Boolean(model.apiKey),
        modelName: model.modelName,
        modelFamily: model.modelFamily,
        baseUrl: model.baseUrl,
        apiKeySet: Boolean(model.apiKey),
        apiKeyHint: maskKey(model.apiKey),
      };
    }),
  };
}

export function saveAgentOverride(id: string, patch: AgentRunOverride): AgentUiItem {
  const preset = findAgentPreset(id);
  const file = loadLocalFile();
  const current = file.overrides?.[id] ?? {};
  const next: AgentRunOverride = {
    baseUrl: patch.baseUrl?.trim() || current.baseUrl,
    modelName: patch.modelName?.trim() || current.modelName,
    modelFamily: patch.modelFamily?.trim() || current.modelFamily,
    apiKey: patch.apiKey?.trim() || current.apiKey,
  };
  const overrides = { ...(file.overrides ?? {}), [id]: next };
  writeFileSync(
    LOCAL_PATH,
    stringifyYaml(
      { overrides },
      { lineWidth: 0 },
    ),
    'utf-8',
  );
  const model = resolvedModel(preset);
  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    fromEnv: preset.fromEnv,
    configured: Boolean(model.apiKey),
    modelName: model.modelName,
    modelFamily: model.modelFamily,
    baseUrl: model.baseUrl,
    apiKeySet: Boolean(model.apiKey),
    apiKeyHint: maskKey(model.apiKey),
  };
}

/** worker 覆盖用的环境变量。无覆盖且 fromEnv 时沿用进程 .env。 */
export function resolveAgentRunEnv(
  agentId: string | undefined,
  inline?: AgentRunOverride,
): NodeJS.ProcessEnv {
  const preset = findAgentPreset(agentId);
  const local = localOverride(preset.id);
  const hasInline = Boolean(
    inline?.baseUrl?.trim() ||
      inline?.modelName?.trim() ||
      inline?.modelFamily?.trim() ||
      inline?.apiKey?.trim(),
  );
  const hasLocal = Boolean(local.baseUrl || local.modelName || local.modelFamily || local.apiKey);

  if (preset.fromEnv && !hasInline && !hasLocal) return {};

  const model = resolvedModel(preset, inline);
  if (!model.apiKey) {
    throw new Error(
      `视觉 Agent「${preset.label}」未配置密钥。请在控制台填写 API Key，或写入 .env。`,
    );
  }
  if (!model.baseUrl || !model.modelName) {
    throw new Error(`视觉 Agent「${preset.label}」缺少 Base URL 或模型名。`);
  }

  const env: NodeJS.ProcessEnv = {
    MIDSCENE_MODEL_BASE_URL: model.baseUrl,
    MIDSCENE_MODEL_API_KEY: model.apiKey,
    MIDSCENE_MODEL_NAME: model.modelName,
    MIDSCENE_MODEL_FAMILY: model.modelFamily || undefined,
    OPENAI_API_KEY: model.apiKey,
    OPENAI_BASE_URL: model.baseUrl,
  };
  if (preset.extraEnv) {
    for (const [key, value] of Object.entries(preset.extraEnv)) {
      if (value?.trim()) env[key] = value;
    }
  }
  return env;
}
