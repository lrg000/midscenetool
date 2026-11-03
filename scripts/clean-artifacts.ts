/**
 * midscene_run 产物清理（不触及 data/packages/业务 YAML）。
 *
 * 用法:
 *   npx tsx scripts/clean-artifacts.ts --dry-run
 *   npx tsx scripts/clean-artifacts.ts --days 14
 *   npx tsx scripts/clean-artifacts.ts --days 7 --targets report,screenshots,log,output
 *   npx tsx scripts/clean-artifacts.ts --all-but-latest 3 --targets report
 */
import { pruneMidsceneArtifacts, type ArtifactTarget } from '../core/artifacts-retention.js';

function parseArgs(argv: string[]) {
  let dryRun = false;
  let days = 14;
  let allButLatest: number | undefined;
  let targets: ArtifactTarget[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--days') days = Number(argv[++i]);
    else if (a === '--all-but-latest') allButLatest = Number(argv[++i]);
    else if (a === '--targets') {
      targets = argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as ArtifactTarget[];
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: tsx scripts/clean-artifacts.ts [options]

Options:
  --dry-run              只统计，不删除
  --days <n>             删除早于 n 天的文件（默认 14）
  --all-but-latest <n>   每个目录只保留最新 n 个文件（与 --days 可叠加：先按天再按数量）
  --targets a,b,c        默认 report,screenshots,log,output,tmp
                         可选: report,screenshots,log,output,tmp,cache
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`无效 --days: ${days}`);
  }
  if (allButLatest !== undefined && (!Number.isFinite(allButLatest) || allButLatest < 0)) {
    throw new Error(`无效 --all-but-latest: ${allButLatest}`);
  }

  return { dryRun, days, allButLatest, targets };
}

const opts = parseArgs(process.argv.slice(2));
const summary = pruneMidsceneArtifacts({
  dryRun: opts.dryRun,
  retainDays: opts.days,
  keepLatestPerDir: opts.allButLatest,
  targets: opts.targets,
});

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
console.log(`\n${opts.dryRun ? '[dry-run] ' : ''}产物清理完成`);
console.log(`  扫描文件: ${summary.scannedFiles}`);
console.log(`  删除文件: ${summary.deletedFiles}`);
console.log(`  释放体积: ${mb(summary.deletedBytes)}`);
for (const row of summary.byTarget) {
  if (!row.deletedFiles) continue;
  console.log(`  - ${row.target}: ${row.deletedFiles} files / ${mb(row.deletedBytes)}`);
}
