import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalogResponse } from './catalog.js';
import { listAgentsForUi, saveAgentOverride } from './agents.js';
import { isRunActive, startDashboardRun, stopDashboardRun } from './runner.js';
import { listDashboardDevices } from './devices.js';
import { progressEmitter, type ProgressEvent } from '../core/progress-emitter.js';
import {
  addRecordPage,
  addRecordStep,
  generateFromRecord,
  getTrace,
  isRecordActive,
  screenshotRecord,
  startRecord,
  statusPayload,
  stopRecord,
  suggestVerifyFromScreen,
  type AddStepRequest,
  type StartRecordRequest,
} from './record/index.js';

const PORT = Number(process.env.DASHBOARD_PORT ?? 5173);
const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, 'dashboard', 'public');
const eventBuffer: ProgressEvent[] = [];
const MAX_BUFFER = 300;

progressEmitter.on('event', (event: ProgressEvent) => {
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function mimeType(filePath: string): string {
  const ext = extname(filePath);
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  return map[ext] ?? 'application/octet-stream';
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    return false;
  }
  res.writeHead(200, { 'Content-Type': mimeType(filePath) });
  res.end(readFileSync(filePath));
  return true;
}

function listReportsPage(page = 1, pageSize = 10) {
  const outputDir = join(ROOT, 'midscene_run', 'output');
  if (!existsSync(outputDir)) {
    return { reports: [], total: 0, page: 1, pageSize, totalPages: 0 };
  }
  const all = readdirSync(outputDir)
    .filter((name) => name.endsWith('.json') && !name.includes('-report'))
    .map((name) => {
      const full = join(outputDir, name);
      const stat = statSync(full);
      return { name, mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));

  const total = all.length;
  const size = Math.min(50, Math.max(1, pageSize));
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const start = (safePage - 1) * size;
  return {
    reports: all.slice(start, start + size),
    total,
    page: safePage,
    pageSize: size,
    totalPages,
  };
}

function listL5Diagnoses(page = 1, pageSize = 10) {
  const dir = join(ROOT, 'midscene_run', 'l5');
  if (!existsSync(dir)) {
    return { reports: [], total: 0, page: 1, pageSize, totalPages: 0 };
  }
  const all = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const full = join(dir, name);
      const stat = statSync(full);
      let kind = '';
      let title = '';
      try {
        const raw = JSON.parse(readFileSync(full, 'utf-8')) as { kind?: string; title?: string };
        kind = raw.kind ?? '';
        title = raw.title ?? '';
      } catch {
        // ignore
      }
      return {
        name,
        mdName: name.replace(/\.json$/, '.md'),
        kind,
        title,
        mtime: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));

  const total = all.length;
  const size = Math.min(50, Math.max(1, pageSize));
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const start = (safePage - 1) * size;
  return {
    reports: all.slice(start, start + size),
    total,
    page: safePage,
    pageSize: size,
    totalPages,
  };
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/api/catalog' && req.method === 'GET') {
    sendJson(res, 200, loadCatalogResponse());
    return;
  }

  if (path === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, listAgentsForUi());
    return;
  }

  if (path === '/api/agents' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as {
        id?: string;
        baseUrl?: string;
        modelName?: string;
        modelFamily?: string;
        apiKey?: string;
      };
      if (!body.id?.trim()) {
        sendJson(res, 400, { error: '缺少 Agent id' });
        return;
      }
      const agent = saveAgentOverride(body.id.trim(), {
        baseUrl: body.baseUrl,
        modelName: body.modelName,
        modelFamily: body.modelFamily,
        apiKey: body.apiKey,
      });
      sendJson(res, 200, { ok: true, agent, ...listAgentsForUi() });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/devices' && req.method === 'GET') {
    try {
      const devices = await listDashboardDevices();
      sendJson(res, 200, { devices, refreshedAt: new Date().toISOString() });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
        devices: [],
      });
    }
    return;
  }

  if (path === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, {
      state: progressEmitter.getState(),
      running: isRunActive(),
      recording: isRecordActive(),
      record: statusPayload(),
    });
    return;
  }

  if (path === '/api/reports' && req.method === 'GET') {
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    sendJson(res, 200, listReportsPage(
      Number.isFinite(page) ? page : 1,
      Number.isFinite(pageSize) ? pageSize : 10,
    ));
    return;
  }

  if (path === '/api/l5/reports' && req.method === 'GET') {
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    sendJson(res, 200, listL5Diagnoses(
      Number.isFinite(page) ? page : 1,
      Number.isFinite(pageSize) ? pageSize : 10,
    ));
    return;
  }

  if (path === '/api/run' && req.method === 'POST') {
    if (isRecordActive()) {
      sendJson(res, 409, { error: '录制进行中，请先停止录制再执行用例' });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as {
        kind?: string;
        id?: string;
        skipLaunch?: boolean;
        runHandoff?: boolean;
        deviceIds?: string[];
        jobs?: Array<{
          kind: string;
          id: string;
          deviceId: string;
          skipLaunch?: boolean;
          runHandoff?: boolean;
          title?: string;
          androidPackage?: string;
          mobile?: string;
          otp?: string;
          accountProfile?: string;
          agentId?: string;
          agentConfig?: {
            baseUrl?: string;
            modelName?: string;
            modelFamily?: string;
            apiKey?: string;
          };
        }>;
      };
      if (Array.isArray(body.jobs) && body.jobs.length) {
        const runId = startDashboardRun({
          jobs: body.jobs.map((j) => ({
            kind: j.kind as 'page' | 'flow' | 'aside' | 'explore',
            id: j.id,
            deviceId: j.deviceId,
            skipLaunch: j.skipLaunch,
            runHandoff: j.runHandoff,
            title: j.title,
            androidPackage: j.androidPackage,
            mobile: j.mobile,
            otp: j.otp,
            accountProfile: j.accountProfile,
            agentId: j.agentId,
            agentConfig: j.agentConfig,
          })),
        });
        sendJson(res, 200, { runId });
        return;
      }
      if (!body.kind || !body.id) {
        sendJson(res, 400, { error: '缺少 jobs，或 legacy 的 kind/id' });
        return;
      }
      const runId = startDashboardRun({
        kind: body.kind as 'page' | 'flow' | 'aside' | 'explore',
        id: body.id,
        skipLaunch: body.skipLaunch,
        runHandoff: body.runHandoff,
        deviceIds: Array.isArray(body.deviceIds) ? body.deviceIds : undefined,
      });
      sendJson(res, 200, { runId });
    } catch (err) {
      sendJson(res, 409, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/run/stop' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as { deviceId?: string };
      const result = stopDashboardRun({
        deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
      });
      sendJson(res, result.stopped ? 200 : 409, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // ── 录制生成 ──────────────────────────────────────────
  if (path === '/api/record/status' && req.method === 'GET') {
    sendJson(res, 200, statusPayload());
    return;
  }

  if (path === '/api/record/trace' && req.method === 'GET') {
    try {
      const sessionId = url.searchParams.get('sessionId') ?? undefined;
      sendJson(res, 200, { trace: getTrace(sessionId) });
    } catch (err) {
      sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/start' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as StartRecordRequest;
      const trace = await startRecord(body);
      sendJson(res, 200, { sessionId: trace.sessionId, trace, status: statusPayload() });
    } catch (err) {
      sendJson(res, 409, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/stop' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as { sessionId?: string };
      const trace = await stopRecord(body.sessionId);
      sendJson(res, 200, { trace, status: statusPayload() });
    } catch (err) {
      sendJson(res, 409, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/step' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as AddStepRequest & {
        sessionId?: string;
      };
      const { sessionId, ...step } = body;
      const trace = addRecordStep(step, sessionId);
      sendJson(res, 200, { trace, status: statusPayload() });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/page' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        sessionId?: string;
        pageKey: string;
        title?: string;
      };
      const trace = addRecordPage(
        { pageKey: body.pageKey, title: body.title },
        body.sessionId,
      );
      sendJson(res, 200, { trace, status: statusPayload() });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/screenshot' && req.method === 'POST') {
    try {
      const shot = await screenshotRecord();
      sendJson(res, 200, shot);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/suggest-verify' && req.method === 'POST') {
    try {
      const result = await suggestVerifyFromScreen();
      sendJson(res, 200, { ...result, status: statusPayload() });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/record/generate' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        sessionId?: string;
        overwrite?: boolean;
      };
      const result = generateFromRecord({
        sessionId: body.sessionId,
        overwrite: !!body.overwrite,
      });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    for (const event of eventBuffer) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const onEvent = (event: ProgressEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    progressEmitter.on('event', onEvent);
    req.on('close', () => progressEmitter.off('event', onEvent));
    return;
  }

  if (path.startsWith('/midscene_run/') && req.method === 'GET') {
    const rel = path.replace(/^\/+/, '');
    const filePath = join(ROOT, rel);
    if (filePath.startsWith(join(ROOT, 'midscene_run')) && existsSync(filePath) && statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': mimeType(filePath) });
      res.end(readFileSync(filePath));
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url?.startsWith('/api/') || req.url?.startsWith('/midscene_run/')) {
    await handleApi(req, res);
    return;
  }
  if (serveStatic(req, res)) return;
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`\nMidsceneTool 控制台已启动`);
  console.log(`  本地访问: http://127.0.0.1:${PORT}`);
  console.log(`  项目目录: ${ROOT}`);
  console.log(`  按 Ctrl+C 停止\n`);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // direct entry
}
