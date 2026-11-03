import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentConfig } from './types.js';

export type ArtifactTarget =
  | 'report'
  | 'screenshots'
  | 'log'
  | 'output'
  | 'tmp'
  | 'cache';

const DEFAULT_TARGETS: ArtifactTarget[] = [
  'report',
  'screenshots',
  'log',
  'output',
  'tmp',
];

export interface PruneOptions {
  /** 项目根；默认 process.cwd() */
  rootDir?: string;
  midsceneRunRel?: string;
  retainDays: number;
  /** 每个目标目录额外只保留最新 N 个文件（按 mtime）；不设则仅按天数 */
  keepLatestPerDir?: number;
  targets?: ArtifactTarget[];
  dryRun?: boolean;
  /** Midscene 定位缓存默认保留；显式 targets 含 cache 时才清 */
  includeCache?: boolean;
}

export interface PruneTargetSummary {
  target: ArtifactTarget;
  scannedFiles: number;
  deletedFiles: number;
  deletedBytes: number;
}

export interface PruneSummary {
  scannedFiles: number;
  deletedFiles: number;
  deletedBytes: number;
  byTarget: PruneTargetSummary[];
}

function resolveTargetDir(root: string, midsceneRunRel: string, target: ArtifactTarget): string {
  return join(root, midsceneRunRel, target);
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(current, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function fileMeta(path: string): { mtimeMs: number; size: number } | null {
  try {
    const st = statSync(path);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function deleteFile(path: string, dryRun: boolean): boolean {
  if (dryRun) return true;
  try {
    unlinkSync(path);
    return true;
  } catch {
    try {
      rmSync(path, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 按保留天数（及可选「每目录最新 N 个」）清理 midscene_run 产物。
 * 不删除业务配置；默认不清理 cache（定位缓存）。
 */
export function pruneMidsceneArtifacts(options: PruneOptions): PruneSummary {
  const root = options.rootDir ?? process.cwd();
  const midsceneRunRel = options.midsceneRunRel ?? 'midscene_run';
  const dryRun = options.dryRun ?? false;
  const cutoff = Date.now() - Math.max(0, options.retainDays) * 24 * 60 * 60 * 1000;

  let targets = [...(options.targets ?? DEFAULT_TARGETS)];
  if (options.includeCache && !targets.includes('cache')) {
    targets.push('cache');
  }

  const byTarget: PruneTargetSummary[] = [];
  let scannedFiles = 0;
  let deletedFiles = 0;
  let deletedBytes = 0;

  for (const target of targets) {
    const dir = resolveTargetDir(root, midsceneRunRel, target);
    const files = listFilesRecursive(dir);
    const metas = files
      .map((path) => {
        const meta = fileMeta(path);
        return meta ? { path, ...meta } : null;
      })
      .filter((x): x is { path: string; mtimeMs: number; size: number } => Boolean(x))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    scannedFiles += metas.length;
    const toDelete = new Set<string>();

    for (const row of metas) {
      if (row.mtimeMs < cutoff) toDelete.add(row.path);
    }

    if (options.keepLatestPerDir !== undefined && options.keepLatestPerDir >= 0) {
      const keep = options.keepLatestPerDir;
      for (let i = keep; i < metas.length; i++) {
        toDelete.add(metas[i].path);
      }
    }

    let targetDeleted = 0;
    let targetBytes = 0;
    for (const row of metas) {
      if (!toDelete.has(row.path)) continue;
      if (!deleteFile(row.path, dryRun)) continue;
      targetDeleted += 1;
      targetBytes += row.size;
    }

    deletedFiles += targetDeleted;
    deletedBytes += targetBytes;
    byTarget.push({
      target,
      scannedFiles: metas.length,
      deletedFiles: targetDeleted,
      deletedBytes: targetBytes,
    });
  }

  return { scannedFiles, deletedFiles, deletedBytes, byTarget };
}

/** 会话启动时可选自动清理（由 environment.yaml artifacts 控制） */
export function maybeAutoPruneArtifacts(env: EnvironmentConfig): PruneSummary | null {
  const cfg = env.artifacts;
  if (!cfg?.autoPruneOnStart) return null;
  const retainDays = cfg.retainDays ?? 14;
  return pruneMidsceneArtifacts({
    midsceneRunRel: env.paths.midsceneRun,
    retainDays,
    keepLatestPerDir: cfg.keepLatestReports,
    targets: (cfg.targets as ArtifactTarget[] | undefined) ?? DEFAULT_TARGETS,
    dryRun: false,
  });
}
