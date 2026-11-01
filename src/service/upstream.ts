// The only place that talks to the configured magpie endpoint. Failure kinds
// are kept apart so the panel can say what actually went wrong.
import { describeServiceError, type ServiceErrorKind } from '../shared/magpie.ts';

export type UpstreamFailureKind = Extract<ServiceErrorKind, `upstream-${string}`>;

export type UpstreamFailure = {
  kind: UpstreamFailureKind;
  message: string;
  status?: number;
};

export type UpstreamAnswer = { ok: true; value: unknown } | { ok: false; error: UpstreamFailure };

export type UpstreamOptions = {
  baseUrl: string;
  apiKey: string | null;
  path: string;
  query: Record<string, string>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
};

const MAX_REDIRECTS = 3;

const joinPath = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

const isAbort = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
};

const failure = (kind: UpstreamFailureKind, status?: number): UpstreamFailure => ({
  kind,
  status,
  message: describeServiceError(kind),
});

/** GET a JSON document, with the key pinned to the origin it was configured for. */
export const requestUpstream = async (options: UpstreamOptions): Promise<UpstreamAnswer> => {
  const { baseUrl, apiKey, path, query, timeoutMs, fetchImpl } = options;

  let target: URL;
  try {
    target = new URL(joinPath(baseUrl, path));
  } catch {
    return { ok: false, error: { kind: 'upstream-network', message: 'The configured endpoint is not a URL.' } };
  }
  for (const [name, value] of Object.entries(query)) target.searchParams.set(name, value);

  const origin = target.origin;
  let redirects = 0;

  for (;;) {
    const headers: Record<string, string> = { accept: 'application/json' };
    // Same-origin only: a redirect off the configured origin never sees the key.
    if (apiKey !== null && target.origin === origin) headers.authorization = `Bearer ${apiKey}`;

    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, error: isAbort(error) ? failure('upstream-timeout') : failure('upstream-network') };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          ok: false,
          error: {
            kind: 'upstream-status',
            status: response.status,
            message: `The gateway answered HTTP ${response.status} without a Location header.`,
          },
        };
      }
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        return { ok: false, error: failure('upstream-status', response.status) };
      }
      if (next.origin !== origin) return { ok: false, error: failure('upstream-redirect', response.status) };
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, error: failure('upstream-redirect', response.status) };
      }
      if (redirects >= MAX_REDIRECTS) {
        return {
          ok: false,
          error: { kind: 'upstream-redirect', status: response.status, message: 'The gateway redirected too many times.' },
        };
      }
      target = next;
      redirects += 1;
      continue;
    }

    if (response.status === 401) return { ok: false, error: failure('upstream-unauthorized', 401) };
    if (response.status === 403) return { ok: false, error: failure('upstream-forbidden', 403) };
    if (!response.ok) return { ok: false, error: failure('upstream-status', response.status) };

    let body: string;
    try {
      body = await response.text();
    } catch {
      return { ok: false, error: failure('upstream-network', response.status) };
    }

    try {
      return { ok: true, value: JSON.parse(body) as unknown };
    } catch {
      return { ok: false, error: failure('upstream-not-json', response.status) };
    }
  }
};
