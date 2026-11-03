import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  addStepFromRequest,
  currentPage,
  getActiveTrace,
  persistTrace,
  startNewPage,
} from './session-store.js';
import { progressEmitter } from '../../core/progress-emitter.js';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let lastPath = '';

function log(message: string): void {
  const runId = getActiveTrace()?.sessionId ?? 'record';
  progressEmitter.emitEvent({ type: 'log', runId, message: `[record] ${message}` });
  console.log(`[record] ${message}`);
}

function pathKey(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    return (segs[segs.length - 1] || segs[0] || 'home')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 40) || 'home';
  } catch {
    return 'page';
  }
}

async function maybeSplitPage(url: string): Promise<void> {
  const trace = getActiveTrace();
  if (!trace || trace.status !== 'recording') return;
  const key = pathKey(url);
  if (!lastPath) {
    lastPath = key;
    return;
  }
  if (key === lastPath) return;
  lastPath = key;
  const exists = trace.pages.some((p) => p.pageKey === key);
  if (!exists) {
    try {
      startNewPage({ pageKey: key, title: key });
      log(`URL 变化，新页面: ${key}`);
    } catch {
      // ignore duplicate
    }
  } else {
    const idx = trace.pages.findIndex((p) => p.pageKey === key);
    if (idx >= 0) {
      trace.currentPageIndex = idx;
      persistTrace(trace);
    }
  }
}

function bestText(el: { text?: string; aria?: string; placeholder?: string; name?: string; id?: string }): string {
  return (
    (el.text || '').trim() ||
    (el.aria || '').trim() ||
    (el.placeholder || '').trim() ||
    (el.name || '').trim() ||
    (el.id || '').trim() ||
    'element'
  );
}

/** 注入页面：捕获 click / fill / change */
const INJECT = `
(() => {
  if (window.__midsceneRecordHooked) return;
  window.__midsceneRecordHooked = true;

  function desc(el) {
    if (!el || !el.tagName) return null;
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || '').trim().slice(0, 80);
    const aria = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const id = el.id || '';
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role') || '';
    return { tag, text, aria, placeholder, name, id, type, role };
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const el = t.closest('a,button,[role=button],input[type=submit],input[type=button],label,summary,[onclick]') || t;
    const d = desc(el);
    if (!d) return;
    window.__midsceneRecordPush && window.__midsceneRecordPush({ kind: 'click', ...d, href: location.href });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    const d = desc(el);
    if (!d) return;
    const value = el.type === 'password' ? '***' : String(el.value || '').slice(0, 120);
    window.__midsceneRecordPush && window.__midsceneRecordPush({
      kind: 'fill', ...d, value, href: location.href
    });
  }, true);
})();
`;

async function attachPageListeners(p: Page): Promise<void> {
  await p.exposeFunction('__midsceneRecordPush', (payload: Record<string, string>) => {
    try {
      void handleBrowserEvent(payload);
    } catch (err) {
      log(`事件处理失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await p.addInitScript(INJECT);
  await p.evaluate(INJECT);

  p.on('framenavigated', (frame) => {
    if (frame === p.mainFrame()) {
      void maybeSplitPage(frame.url());
      void p.evaluate(INJECT).catch(() => undefined);
    }
  });
}

function handleBrowserEvent(payload: Record<string, string>): void {
  const href = payload.href || '';
  void maybeSplitPage(href);

  if (payload.kind === 'fill') {
    const text = bestText(payload);
    const isCheck =
      payload.type === 'checkbox' || payload.type === 'radio' || payload.role === 'checkbox';
    if (isCheck) {
      addStepFromRequest({
        kind: 'checkbox',
        text,
        label: `勾选 ${text}`,
        locatePrompt: `The checkbox near "${text}"`,
      });
      log(`录到 checkbox: ${text}`);
      return;
    }
    addStepFromRequest({
      kind: 'fill',
      text,
      value: payload.value,
      label: `填写 ${text}`,
      locatePrompt: `The input field "${text}" (placeholder/name/label)`,
    });
    log(`录到 fill: ${text}`);
    return;
  }

  if (payload.kind === 'click') {
    const text = bestText(payload);
    addStepFromRequest({
      kind: 'tap-text',
      text,
      label: `点击 ${text}`,
      locatePrompt: `The clickable control with text or aria-label "${text}"`,
    });
    log(`录到 click: ${text}`);
  }
}

export async function startPlaywrightRecord(startUrl: string): Promise<void> {
  if (browser) {
    throw new Error('Playwright 浏览器已在录制中');
  }
  const url = startUrl.trim();
  if (!url) throw new Error('浏览器录制需要起始 URL');

  log(`启动 Playwright Chromium → ${url}`);
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  lastPath = '';
  await attachPageListeners(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await maybeSplitPage(url);

  const title = await page.title().catch(() => 'recorded');
  const trace = getActiveTrace();
  if (trace) {
    const cur = currentPage(trace);
    if (cur.pageKey === 'recorded' || !cur.title) {
      cur.title = title || cur.pageKey;
    }
    addStepFromRequest({
      kind: 'wait-page',
      text: title || url,
      label: `等待页面就绪: ${title || url}`,
      assertPrompt: `Is the browser page loaded (title or content related to "${(title || url).slice(0, 60)}")? Answer only true or false.`,
    });
    persistTrace(trace);
  }
  log('Playwright 录制已开始：在弹出的浏览器里点击/填写即可');
}

export async function stopPlaywrightRecord(): Promise<void> {
  try {
    if (page) await page.close().catch(() => undefined);
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  } finally {
    page = null;
    context = null;
    browser = null;
    lastPath = '';
    log('Playwright 浏览器已关闭');
  }
}

export function isPlaywrightRecording(): boolean {
  return browser != null;
}
