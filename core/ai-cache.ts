/**
 * 轻量 prompt 结果缓存（与 Midscene 元素定位缓存分目录：midscene_run/cache/prompt）。
 * 业务步骤默认可不使用；仅供可选加速，带 TTL，避免永久脏数据。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface CacheEntry {
  value: unknown;
  createdAt: string;
  /** 过期时间戳 ms；缺省表示永不过期（兼容旧条目） */
  expiresAt?: number;
}

export class AiCache {
  private cacheDir: string;
  private memory = new Map<string, CacheEntry>();
  /** 默认 TTL（毫秒）；0 = 不设过期 */
  private defaultTtlMs: number;

  constructor(cacheDir: string, defaultTtlMs = 7 * 24 * 60 * 60 * 1000) {
    this.cacheDir = cacheDir;
    this.defaultTtlMs = defaultTtlMs;
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  }

  private key(prompt: string, kind: string): string {
    return createHash('sha256').update(`${kind}:${prompt}`).digest('hex');
  }

  private filePath(k: string): string {
    return join(this.cacheDir, `${k}.json`);
  }

  private isFresh(entry: CacheEntry): boolean {
    if (entry.expiresAt === undefined) return true;
    return Date.now() < entry.expiresAt;
  }

  get<T>(prompt: string, kind: string): T | undefined {
    const k = this.key(prompt, kind);
    const mem = this.memory.get(k);
    if (mem) {
      if (!this.isFresh(mem)) {
        this.memory.delete(k);
        return undefined;
      }
      return mem.value as T;
    }

    const filePath = this.filePath(k);
    if (!existsSync(filePath)) return undefined;

    try {
      const entry = JSON.parse(readFileSync(filePath, 'utf-8')) as CacheEntry;
      if (!this.isFresh(entry)) return undefined;
      this.memory.set(k, entry);
      return entry.value as T;
    } catch {
      return undefined;
    }
  }

  set(prompt: string, kind: string, value: unknown, ttlMs?: number): void {
    const k = this.key(prompt, kind);
    const ttl = ttlMs ?? this.defaultTtlMs;
    const entry: CacheEntry = {
      value,
      createdAt: new Date().toISOString(),
      expiresAt: ttl > 0 ? Date.now() + ttl : undefined,
    };
    this.memory.set(k, entry);
    writeFileSync(this.filePath(k), JSON.stringify(entry), 'utf-8');
  }
}
