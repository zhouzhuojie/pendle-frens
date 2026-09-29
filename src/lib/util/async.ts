/** Concurrency + retry helpers. No external dependencies. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Map with a hard concurrency ceiling. Preserves input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelay = options.baseDelayMs ?? 250;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = options.shouldRetry ? options.shouldRetry(error) : true;
      if (!retryable || attempt === attempts - 1) break;
      await sleep(baseDelay * 2 ** attempt + Math.random() * 100);
    }
  }
  throw lastError;
}

/** Deduplicate concurrent calls for the same key, with a TTL memory layer. */
export class SingleFlight<K, V> {
  private inflight = new Map<K, Promise<V>>();
  private value = new Map<K, { at: number; data: V }>();

  constructor(private ttlMs: number) {}

  peek(key: K): { at: number; data: V } | undefined {
    return this.value.get(key);
  }

  async run(key: K, fn: () => Promise<V>, force = false): Promise<V> {
    const cached = this.value.get(key);
    if (!force && cached && Date.now() - cached.at < this.ttlMs) return cached.data;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = fn()
      .then((data) => {
        this.value.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.value.clear();
    this.inflight.clear();
  }
}
