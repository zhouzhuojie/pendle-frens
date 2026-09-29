/** Minimal JSON fetch helper with timeouts and retry-friendly errors. */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function getJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  return requestJson<T>(url, { method: 'GET' }, options);
}

export async function postJson<T>(url: string, body: unknown, options: HttpOptions = {}): Promise<T> {
  return requestJson<T>(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    options,
  );
}

async function requestJson<T>(url: string, init: RequestInit, options: HttpOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...init.headers, ...options.headers },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await safeText(response);
      throw new HttpError(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`, response.status, url);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  // Network / abort errors are worth one more attempt.
  return error instanceof Error;
}
