/**
 * Runtime configuration, injected into `index.html` by `server.js` at request time.
 *
 * Container environment variables do not become browser configuration on their own, and baking
 * them into the bundle would need one build per environment. This is the POC-local convention the
 * integration guide §3 asks for: an explicit allowlist of non-secret values, serialized into the
 * shell before any script that reads them runs.
 *
 * The allowlist is deliberately short. `platformApiUrl` used to be here and is not any more —
 * the browser never calls the platform directly (file operations go through this POC's own
 * backend), so exposing it bought nothing. Nothing secret may ever be added.
 */
export interface RuntimeConfig {
  /** Deployed path prefix, '' at the domain root. Drives `<base href>` and the API path. */
  basePath: string;
  /** The portal's bare origin. Required in production; see `readPortalOrigin` below. */
  portalOrigin: string;
  slug: string;
  version: string;
}

declare global {
  interface Window {
    __SAILS__?: Partial<RuntimeConfig>;
  }
}

const injected = window.__SAILS__ ?? {};

export const runtimeConfig: RuntimeConfig = {
  basePath: injected.basePath ?? '',
  // No wildcard fallback. An unset origin stays unset so it fails the check below, rather than
  // silently becoming a POC that accepts a token from any page able to frame it.
  portalOrigin: injected.portalOrigin ?? '',
  slug: injected.slug ?? 'local-dev',
  version: injected.version ?? 'dev',
};

/**
 * The one path prefix this POC's token may be attached to, resolved once.
 *
 * Requests are matched against this structurally (origin + path boundary), never by string
 * prefix — see `core/poc-api.ts`.
 */
export const apiBasePath = `${runtimeConfig.basePath.replace(/\/$/, '')}/api`;

/**
 * A bare origin, or null. `providePocBridge` throws on anything invalid, which is the right
 * behavior for a misconfigured deployment but produces a blank page — so `main.ts` checks first
 * and renders a readable configuration error instead of letting bootstrap die.
 */
export function readPortalOrigin(value: string): string | null {
  if (!value || value === '*') {
    return null;
  }
  try {
    const parsed = new URL(value);
    // A path, query or fragment means a URL was supplied where an origin belongs — rejected,
    // because there is no safe way to guess the intent. Everything else is normalised: a trailing
    // slash, an explicit default port and an upper-case scheme all denote the same origin.
    //
    // Returning `parsed.origin` rather than the raw string is what makes the comparison work.
    // `event.origin` is always the bare normalised form, so a configured
    // "https://portal.example.com/" kept verbatim would reject every message from the portal while
    // looking perfectly configured.
    if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
