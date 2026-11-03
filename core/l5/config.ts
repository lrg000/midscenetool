import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getCredentials } from '../credentials.js';
import type { AccountProfile } from '../account-profile.js';
import type { L5Config, L5HttpQuery } from './types.js';
import { contactsAligned } from './contacts.js';

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'config', 'l5.yaml');

let cached: L5Config | null | undefined;

export function loadL5Config(): L5Config {
  if (cached !== undefined) return cached ?? { enabled: false };
  if (!existsSync(CONFIG_PATH)) {
    cached = { enabled: false };
    return cached;
  }
  cached = (parseYaml(readFileSync(CONFIG_PATH, 'utf-8')) as L5Config) ?? { enabled: false };
  return cached;
}

export function resetL5ConfigCache(): void {
  cached = undefined;
}

export function isL5Enabled(): boolean {
  const cfg = loadL5Config();
  if (cfg.enabled === false) return false;
  return true;
}

let runtimeEnv: Record<string, string> = {};

export function setL5RuntimeEnv(vars: Record<string, string> | undefined): void {
  runtimeEnv = { ...(vars ?? {}) };
}

export function getL5RuntimeEnv(): Record<string, string> {
  return runtimeEnv;
}

function envLookup(name: string): string {
  const fromJs = runtimeEnv[name];
  if (fromJs != null && String(fromJs).trim() !== '') return String(fromJs).trim();
  return process.env[name] ?? '';
}

export function interpolate(
  raw: string,
  profile?: AccountProfile | null,
): string {
  const creds = getCredentials(profile);
  const mobile = envLookup('PHONE') || creds.mobile;
  return raw
    .replace(/\{\{mobile\}\}/g, mobile)
    .replace(/\{\{otp\}\}/g, creds.otp)
    .replace(/\{\{env:([A-Z0-9_]+)\}\}/g, (_, name: string) => envLookup(name));
}

export function interpolateDeep<T>(value: T, profile?: AccountProfile | null): T {
  if (typeof value === 'string') return interpolate(value, profile) as T;
  if (Array.isArray(value)) {
    return value.map((v) => interpolateDeep(v, profile)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, profile);
    }
    return out as T;
  }
  return value;
}

export function readJsonPath(data: unknown, path?: string): unknown {
  if (!path?.trim()) return data;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = data;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(p)) {
      cur = cur[Number(p)];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function reduceJson(value: unknown, reduce?: L5HttpQuery['jsonReduce']): unknown {
  if (!reduce) return value;
  if (!Array.isArray(value) || value.length === 0) return value;
  if (reduce === 'first') return value[0];
  if (reduce === 'last') return value[value.length - 1];
  const nums = value
    .map((v) => Number(String(v).replace(/[^\d.-]/g, '')))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return value;
  if (reduce === 'max') return Math.max(...nums);
  if (reduce === 'min') return Math.min(...nums);
  return value;
}

export function coerceValue(value: unknown, mode?: 'string' | 'number'): unknown {
  if (mode === 'number') {
    const n = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : value;
  }
  if (value == null) return value;
  return String(value).trim();
}

export function valuesAligned(
  values: unknown[],
  coerce?: 'string' | 'number' | 'contacts',
  tolerance = 0,
  opts?: { loginPhone?: string },
): boolean {
  if (coerce === 'contacts') {
    return contactsAligned(values, opts?.loginPhone ?? '');
  }
  const mapped = values.map((v) => coerceValue(v, coerce));
  if (mapped.length < 2) return true;
  const first = mapped[0];
  return mapped.every((v) => {
    if (coerce === 'number' && typeof first === 'number' && typeof v === 'number') {
      return Math.abs(first - v) <= tolerance;
    }
    return String(first) === String(v);
  });
}
