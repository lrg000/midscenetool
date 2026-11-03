import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  AddStepRequest,
  NewPageRequest,
  RecordMode,
  RecordPage,
  RecordStep,
  RecordTrace,
  StartRecordRequest,
} from './types.js';

const ROOT = process.cwd();

export function recordsDir(): string {
  return join(ROOT, 'midscene_run', 'records');
}

function ensureRecordsDir(): void {
  mkdirSync(recordsDir(), { recursive: true });
}

export function tracePath(sessionId: string): string {
  return join(recordsDir(), `${sessionId}.json`);
}

function newSessionId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${randomBytes(3).toString('hex')}`;
}

function sanitizePageKey(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'recorded';
}

function sanitizePackageId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
  if (!s) throw new Error('packageId 不能为空');
  return s;
}

function inferKind(packageId: string): StartRecordRequest['kind'] {
  if (packageId.includes('postlogin')) return 'loan-postlogin';
  if (packageId.startsWith('t')) return 'loan-shell';
  return 'standalone';
}

function defaultDomains(kind: string): string[] {
  if (kind === 'loan-shell' || kind === 'loan-postlogin') return ['common', 'loan'];
  return ['common'];
}

function emptyPage(pageKey: string, title: string): RecordPage {
  return { pageKey: sanitizePageKey(pageKey), title: title || pageKey, steps: [] };
}

/** 单例录制会话（内存 + 磁盘） */
let active: RecordTrace | null = null;

export function getActiveTrace(): RecordTrace | null {
  return active;
}

export function isRecordActive(): boolean {
  return active?.status === 'recording';
}

export function persistTrace(trace: RecordTrace): void {
  ensureRecordsDir();
  trace.updatedAt = new Date().toISOString();
  writeFileSync(tracePath(trace.sessionId), JSON.stringify(trace, null, 2), 'utf-8');
}

export function loadTraceFromDisk(sessionId: string): RecordTrace | null {
  const p = tracePath(sessionId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as RecordTrace;
}

export function createTrace(req: StartRecordRequest): RecordTrace {
  if (active?.status === 'recording') {
    throw new Error(`已有录制会话进行中: ${active.sessionId}`);
  }

  const packageId = sanitizePackageId(req.packageId);
  const kind = req.kind ?? inferKind(packageId) ?? 'standalone';
  const pageKey = sanitizePageKey(req.pageKey ?? 'recorded');
  const now = new Date().toISOString();
  const sessionId = newSessionId();

  const trace: RecordTrace = {
    sessionId,
    mode: req.mode,
    createdAt: now,
    updatedAt: now,
    meta: {
      packageId,
      appLabel: (req.appLabel ?? packageId).trim() || packageId,
      androidPackage: (req.androidPackage ?? '').trim(),
      kind,
      actionDomains:
        Array.isArray(req.actionDomains) && req.actionDomains.length
          ? req.actionDomains
          : defaultDomains(kind),
      description: req.description?.trim() || undefined,
      testMobile: req.testMobile?.trim() || undefined,
      testOtp: req.testOtp?.trim() || undefined,
      startUrl: req.url?.trim() || undefined,
      deviceId: req.deviceId?.trim() || undefined,
      skipLaunch: !!req.skipLaunch,
    },
    pages: [emptyPage(pageKey, req.pageTitle ?? pageKey)],
    currentPageIndex: 0,
    status: 'recording',
  };

  active = trace;
  persistTrace(trace);
  return trace;
}

export function currentPage(trace: RecordTrace = active!): RecordPage {
  if (!trace) throw new Error('无活动录制会话');
  const page = trace.pages[trace.currentPageIndex];
  if (!page) throw new Error('当前页面无效');
  return page;
}

export function appendStep(step: RecordStep, sessionId?: string): RecordTrace {
  const trace = resolveActive(sessionId);
  if (trace.status !== 'recording') throw new Error('会话已停止，无法追加步骤');
  currentPage(trace).steps.push(step);
  persistTrace(trace);
  return trace;
}

export function addStepFromRequest(req: AddStepRequest, sessionId?: string): RecordTrace {
  const kind = req.kind;
  const text = req.text?.trim();
  const label =
    req.label?.trim() ||
    (text ? `${kind}: ${text.slice(0, 40)}` : kind);

  const step: RecordStep = {
    kind,
    label,
    text: text || undefined,
    value: req.value,
    valueKey: req.valueKey,
    action: req.action,
    assertPrompt: req.assertPrompt,
    locatePrompt: req.locatePrompt,
    optional: req.optional,
    section: req.section,
  };

  if (!step.locatePrompt && text && (kind === 'tap-text' || kind === 'checkbox')) {
    step.locatePrompt = `The visible text/control "${text}"`;
  }
  if (!step.assertPrompt && text && kind === 'verify') {
    step.assertPrompt = `The screen shows "${text}". Answer only true or false.`;
  }
  if (!step.assertPrompt && text && kind === 'wait-page') {
    step.assertPrompt = `Is the screen showing content related to "${text}"? Answer only true or false.`;
  }
  if (!step.locatePrompt && text && kind === 'fill') {
    step.locatePrompt = `The input field labeled or near "${text}"`;
  }

  return appendStep(step, sessionId);
}

export function startNewPage(req: NewPageRequest, sessionId?: string): RecordTrace {
  const trace = resolveActive(sessionId);
  if (trace.status !== 'recording') throw new Error('会话已停止');
  const pageKey = sanitizePageKey(req.pageKey);
  if (trace.pages.some((p) => p.pageKey === pageKey)) {
    throw new Error(`页面 key 已存在: ${pageKey}`);
  }
  trace.pages.push(emptyPage(pageKey, req.title ?? pageKey));
  trace.currentPageIndex = trace.pages.length - 1;
  persistTrace(trace);
  return trace;
}

export function markStopped(sessionId?: string): RecordTrace {
  const trace = resolveActive(sessionId);
  trace.status = 'stopped';
  persistTrace(trace);
  return trace;
}

export function clearActive(): void {
  active = null;
}

export function resolveActive(sessionId?: string): RecordTrace {
  if (sessionId) {
    if (active && active.sessionId === sessionId) return active;
    const disk = loadTraceFromDisk(sessionId);
    if (!disk) throw new Error(`找不到会话: ${sessionId}`);
    active = disk;
    return disk;
  }
  if (!active) throw new Error('当前没有录制会话');
  return active;
}

export function statusPayload(): {
  active: boolean;
  mode: RecordMode | null;
  sessionId: string | null;
  status: string | null;
  packageId: string | null;
  pageCount: number;
  stepCount: number;
  currentPageKey: string | null;
} {
  if (!active) {
    return {
      active: false,
      mode: null,
      sessionId: null,
      status: null,
      packageId: null,
      pageCount: 0,
      stepCount: 0,
      currentPageKey: null,
    };
  }
  const page = active.pages[active.currentPageIndex];
  const stepCount = active.pages.reduce((n, p) => n + p.steps.length, 0);
  return {
    active: active.status === 'recording',
    mode: active.mode,
    sessionId: active.sessionId,
    status: active.status,
    packageId: active.meta.packageId,
    pageCount: active.pages.length,
    stepCount,
    currentPageKey: page?.pageKey ?? null,
  };
}
