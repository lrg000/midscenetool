import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { maybeAutoPruneArtifacts } from './artifacts-retention.js';
import type { EnvironmentConfig } from './types.js';

/** 确保 midscene_run 下框架会用到的子目录存在 */
export function ensureMidsceneRunDirs(env: EnvironmentConfig): void {
  const root = join(process.cwd(), env.paths.midsceneRun);
  const subdirs = [
    env.paths.screenshots,
    env.paths.cache,
    join(env.paths.cache, 'prompt'),
    env.paths.tmp,
    env.paths.midsceneOutput,
    env.paths.midsceneReport,
    join(env.paths.midsceneRun, 'log'),
  ];
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  for (const rel of subdirs) {
    const dir = join(process.cwd(), rel);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // 可选：按 environment.yaml artifacts 清理旧产物（默认关闭，不改业务行为）
  const pruned = maybeAutoPruneArtifacts(env);
  if (pruned && pruned.deletedFiles > 0) {
    const mb = (pruned.deletedBytes / (1024 * 1024)).toFixed(1);
    console.log(
      `  [artifacts] 已自动清理 ${pruned.deletedFiles} 个旧文件（约 ${mb} MB）`,
    );
  }
}

export function resolveScreenshotsDir(env: EnvironmentConfig): string {
  return resolve(process.cwd(), env.paths.screenshots);
}
