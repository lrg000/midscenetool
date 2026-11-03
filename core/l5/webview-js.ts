import { createServer } from 'node:net';
import type { AgentSession } from '../types.js';
import { getL5Store } from './types.js';

const JS_KEYS = [
  'APP_AUTH_TOKEN',
  'USER_CODE',
  'MARKET_ID',
  'APP_CODE',
  'PHONE',
  'APP_VERSION',
  'M_COLOR',
] as const;
export type L5JsKey = (typeof JS_KEYS)[number];

/**
 * H5 localStorage.BaseInfo = 原生 webInfo（token/appCode/customerId/versionCode/phone）。
 * 接口 userCode = customerId；APP_VERSION = versionCode；APP_CODE = MARKET_ID = BaseInfo.appCode。
 */
const EXTRACT_EXPR = `(() => {
  const ls = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) ls[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  let base = null;
  try { base = ls.BaseInfo ? JSON.parse(ls.BaseInfo) : null; } catch (e) { base = null; }
  const appCode = base && base.appCode != null ? String(base.appCode) : (ls.appCode || '');
  const token = base && base.token ? String(base.token) : '';
  const userCode = base && base.customerId != null ? String(base.customerId) : '';
  const version = base && base.versionCode != null ? String(base.versionCode) : '';
  const phone = base && base.phone != null ? String(base.phone) : '';
  const mColor = base && base.mColor != null ? String(base.mColor) : '';
  return {
    src: base ? 'ls:BaseInfo' : (ls.appCode ? 'ls:appCode' : ''),
    href: String(location.href || ''),
    localStorageDump: ls,
    APP_AUTH_TOKEN: token,
    APP_CODE: appCode,
    MARKET_ID: appCode,
    USER_CODE: userCode,
    APP_VERSION: version,
    PHONE: phone,
    M_COLOR: mColor,
  };
})()`;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

function parseUnixSockets(raw: string): string[] {
  const names = new Set<string>();
  for (const m of String(raw).matchAll(/@(webview_devtools_remote_[^\s]+|chrome_devtools_remote[^\s]*)/g)) {
    names.add(m[1]);
  }
  return [...names];
}

async function cdpEvaluate(wsUrl: string, expression: string, timeoutMs = 8000): Promise<unknown> {
  const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) throw new Error('当前 Node 无 WebSocket，无法对 WebView 执行 JS');

  return await new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('CDP evaluate 超时'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        if (msg.error) {
          reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          return;
        }
        const evl = msg.result;
        if (evl?.exceptionDetails) {
          reject(new Error(evl.exceptionDetails.text ?? 'JS 异常'));
          return;
        }
        resolve(evl?.result?.value);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP WebSocket 失败'));
    });
  });
}

type JsHit = Record<string, string>;

function asHit(got: unknown): JsHit | null {
  if (!got || typeof got !== 'object') return null;
  const rec = got as Record<string, unknown>;
  const out: JsHit = {};
  for (const key of JS_KEYS) {
    const v = rec[key];
    if (v != null && String(v).trim()) out[key] = String(v).trim();
  }
  if (rec.href) out.href = String(rec.href);
  if (rec.src) out.src = String(rec.src);
  if (rec.localStorageDump != null) {
    try {
      out.localStorageDump =
        typeof rec.localStorageDump === 'string'
          ? rec.localStorageDump
          : JSON.stringify(rec.localStorageDump, null, 2);
    } catch {
      out.localStorageDump = String(rec.localStorageDump);
    }
  }
  if (!out.APP_AUTH_TOKEN && !out.APP_CODE && !out.MARKET_ID && !out.localStorageDump) return null;
  return out;
}

function scoreHit(h: JsHit): number {
  let s = 0;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(h.APP_AUTH_TOKEN ?? '')) s += 10;
  if (/^30\d{2,5}$/.test(h.APP_CODE || h.MARKET_ID || '')) s += 10;
  if (h.USER_CODE) s += 2;
  if (/^https?:/i.test(h.href ?? '')) s += 2;
  if (h.APP_AUTH_TOKEN && (h.APP_CODE || h.MARKET_ID)) s += 8;
  if (h.src === 'ls:BaseInfo') s += 40;
  if (String(h.src || '').startsWith('android.')) s += 10;
  if (h.PHONE) s += 2;
  if (/^https?:/i.test(h.href ?? '') && !/about:blank/i.test(h.href ?? '')) s += 5;
  return s;
}

/**
 * 原生 OTP → B 面 H5 后，从当前 H5 WebView 取服务端登录态（优先 JSBridge `{appCode}-2`）。
 */
export async function extractH5SessionVars(session: AgentSession): Promise<Record<string, string>> {
  const store = getL5Store(session);
  let best: JsHit | null = null;
  let bestScore = -1;
  try {
    const adb = await session.device.getAdb();
    const unix = await adb.shell('cat /proc/net/unix');
    const sockets = parseUnixSockets(String(unix));
    if (!sockets.length) {
      console.log('  L5 JS：未发现 WebView DevTools socket，回退 .env');
      store.runtimeVars = {};
      return {};
    }

    for (const sock of sockets) {
      const port = await freePort();
      try {
        await adb.forwardAbstractPort(port, sock);
        const res = await fetch(`http://127.0.0.1:${port}/json`, {
          signal: AbortSignal.timeout(4000),
        });
        const pages = (await res.json()) as Array<{
          url?: string;
          type?: string;
          webSocketDebuggerUrl?: string;
          title?: string;
        }>;
        for (const page of pages) {
          const ws = page.webSocketDebuggerUrl;
          if (!ws) continue;
          try {
            const got = await cdpEvaluate(ws, EXTRACT_EXPR);
            const hit = asHit(got);
            if (!hit) continue;
            hit.href = hit.href || page.url || '';
            const sc = scoreHit(hit);
            if (sc > bestScore) {
              bestScore = sc;
              best = hit;
            }
          } catch {
            /* 试下一页 */
          }
        }
      } catch {
        /* 试下一 socket */
      } finally {
        try {
          await adb.removePortForward(port);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    console.log(`  L5 JS 抽取失败，回退 .env: ${err instanceof Error ? err.message : String(err)}`);
  }

  const vars: Record<string, string> = {};
  if (best) {
    for (const key of JS_KEYS) {
      if (best[key]) vars[key] = best[key];
    }
  }

  if (vars.MARKET_ID) vars.APP_CODE = vars.MARKET_ID;
  else if (vars.APP_CODE) vars.MARKET_ID = vars.APP_CODE;
  store.runtimeVars = vars;
  const missing = JS_KEYS.filter((k) => !vars[k]);
  console.log('  ---------- L5 H5 localStorage（完整） ----------');
  console.log(best?.localStorageDump || '(empty)');
  console.log('  ---------- L5 字段映射 ----------');
  console.log(
    `  href=${best?.href || '-'} src=${best?.src || '-'}\n` +
      `  token=${vars.APP_AUTH_TOKEN || '(empty)'}\n` +
      `  userCode(customerId)=${vars.USER_CODE || '(empty)'}\n` +
      `  appCode/MARKET_ID=${vars.APP_CODE || vars.MARKET_ID || '(empty)'}\n` +
      `  APP_VERSION(versionCode)=${vars.APP_VERSION || '(empty)'}\n` +
      `  phone=${vars.PHONE || '(empty)'}\n` +
      `  mColor=${vars.M_COLOR || '(empty)'}` +
      (missing.length ? `\n  缺失 ${missing.join(',')}` : ''),
  );
  return vars;
}

export async function waitForH5ApplyButton(
  session: AgentSession,
  opts?: { maxAttempts?: number; optional?: boolean },
): Promise<boolean> {
  const maxAttempts = opts?.maxAttempts ?? 12;
  const prompt = `
Is the H5 loan apply screen visible with a bottom primary button labeled "Apply"
(amount / tenure may show above it, e.g. ₹ 5000 and 7day)?
The Apply button must be on screen and NOT yet tapped.
Answer false for native login, agreement, splash, Success, or permission dialogs.
Answer only true or false.`.trim();

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const visible = await session.agent.aiBoolean(prompt);
      if (visible) {
        console.log(`  已检测到 H5 Apply 按钮（第 ${i + 1} 次）`);
        return true;
      }
    } catch (err) {
      console.log(`  Apply 检测第 ${i + 1} 次失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (opts?.optional) {
    console.log('  未检测到 H5 Apply 按钮（optional），跳过三端核对');
    return false;
  }
  throw new Error('等待 H5 Apply 按钮超时（申请前三端核对未开始）');
}
