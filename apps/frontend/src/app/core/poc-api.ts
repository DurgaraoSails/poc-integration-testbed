import { HttpInterceptorFn } from '@angular/common/http';
import { pocBridgeInterceptor } from '@yateesha-pappala/poc-bridge/poc';

import { apiBasePath } from './runtime-config';

/**
 * Resolves a request URL and answers whether this POC's token may be attached to it.
 *
 * Structural, not a string prefix: the URL is resolved against `<base href>` and compared by
 * origin and path *boundary*. `startsWith('/api')` would also match `/api-docs`, and an absolute
 * `https://evil.example.com/api/...` would sail straight through it — the integration guide §5
 * calls this out specifically ("resolve request URLs structurally using origin and path
 * boundaries, not loose string prefixes").
 */
export function isPocApiUrl(url: string): boolean {
  let resolved: URL;
  try {
    resolved = new URL(url, document.baseURI);
  } catch {
    return false;
  }
  if (resolved.origin !== window.location.origin) {
    return false;
  }
  const path = resolved.pathname.replace(/\/$/, '');
  return path === apiBasePath || path.startsWith(`${apiBasePath}/`);
}

/**
 * `pocBridgeInterceptor`, narrowed to this POC's own API.
 *
 * The library's interceptor attaches `Authorization` to *every* outgoing `HttpClient` request
 * unconditionally (verified in the shipped bundle). That is fine for an app that only ever talks
 * to itself and a latent credential leak for one that does not — the integration guide §6 says to
 * wrap or replace it before using a client that reaches other hosts, and §5 requires an explicit
 * destination allowlist regardless.
 *
 * Wrapping rather than reimplementing keeps the parts that are genuinely hard — one shared
 * refresh across concurrent 401s, and a retry bounded at exactly one — inside the package.
 *
 * The allowlist is a single entry because this POC proxies platform file operations through its
 * own backend. A POC calling `PLATFORM_API_URL/poc-files` directly from the browser would add
 * that origin here, and nothing else.
 */
export const scopedPocBridgeInterceptor: HttpInterceptorFn = (req, next) =>
  isPocApiUrl(req.url) ? pocBridgeInterceptor(req, next) : next(req);
