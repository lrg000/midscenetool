import { loadL5Config, interpolateDeep, readJsonPath } from './config.js';
import type { AccountProfile } from '../account-profile.js';
import type { L5SqlQuery } from './types.js';

function interpolateDbField(raw: string | undefined, profile?: AccountProfile | null): string {
  if (!raw) return '';
  return interpolateDeep(raw, profile);
}

export function isDatabaseConfigured(name = 'default'): boolean {
  const db = loadL5Config().databases?.[name];
  const host = interpolateDbField(db?.host);
  return Boolean(host);
}

export async function runSqlQuery(
  queryId: string,
  profile?: AccountProfile | null,
): Promise<{ rows?: unknown; extracted?: unknown; error?: string }> {
  const cfg = loadL5Config();
  const spec = cfg.sqls?.[queryId];
  if (!spec) return { error: `未配置 sqls.${queryId}` };

  const q = interpolateDeep<L5SqlQuery>(spec, profile);
  const dbName = q.database ?? 'default';
  const db = cfg.databases?.[dbName];
  const host = interpolateDbField(db?.host, profile);
  if (!host) {
    return { error: `数据库 ${dbName} 未配置 host（改 config/l5.yaml 或 .env）` };
  }

  let mysql: typeof import('mysql2/promise');
  try {
    mysql = await import('mysql2/promise');
  } catch {
    return { error: '未安装 mysql2：请执行 npm install mysql2' };
  }

  const conn = await mysql.createConnection({
    host,
    port: db?.port ?? 3306,
    user: interpolateDbField(db?.user, profile),
    password: interpolateDbField(db?.password, profile),
    database: interpolateDbField(db?.database, profile),
  });
  try {
    const params = (Array.isArray(q.params) ? q.params : []) as (string | number | null)[];
    const [rows] = await conn.execute(q.sql, params);
    const extracted = q.extractAll
      ? rows
      : q.column
        ? readJsonPath(Array.isArray(rows) ? rows[0] : rows, q.column)
        : Array.isArray(rows)
          ? rows[0]
          : rows;
    return { rows, extracted };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    await conn.end();
  }
}
