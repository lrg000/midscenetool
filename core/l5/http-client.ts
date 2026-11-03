import { loadL5Config, interpolateDeep, readJsonPath, reduceJson } from './config.js';
import type { L5HttpQuery } from './types.js';
import type { AccountProfile } from '../account-profile.js';

export async function runHttpQuery(
  queryId: string,
  profile?: AccountProfile | null,
): Promise<{ status: number; json?: unknown; extracted?: unknown; error?: string }> {
  const cfg = loadL5Config();
  const spec = cfg.apis?.[queryId];
  if (!spec) return { status: 0, error: `未配置 apis.${queryId}` };

  const q = interpolateDeep<L5HttpQuery>(spec, profile);
  const timeoutMs = cfg.http?.timeoutMs ?? 15000;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(cfg.http?.headers ?? {}),
    ...(q.headers ?? {}),
  };
  for (const [k, v] of Object.entries(headers)) {
    headers[k] = interpolateDeep(String(v), profile);
  }

  const method = (q.method ?? 'GET').toUpperCase();
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (q.body != null && method !== 'GET' && method !== 'HEAD') {
    const body = typeof q.body === 'string' ? q.body : coerceJsonBody(q.body);
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const res = await fetch(q.url, init);
    let json: unknown;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (q.expectStatus != null && res.status !== q.expectStatus) {
      return {
        status: res.status,
        json,
        error: `HTTP ${res.status}，期望 ${q.expectStatus}`,
      };
    }
    return {
      status: res.status,
      json,
      extracted: reduceJson(readJsonPath(json, q.jsonPath), q.jsonReduce),
    };
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** env 插值后的纯数字字符串转成 number，token / 色值 / version 保持字符串 */
function coerceJsonBody(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => coerceJsonBody(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = coerceJsonBody(v, k);
    }
    return out;
  }
  if (
    typeof value === 'string' &&
    key &&
    !/token|color|cookie|auth|version/i.test(key) &&
    /^-?\d+(\.\d+)?$/.test(value)
  ) {
    return Number(value);
  }
  return value;
}
