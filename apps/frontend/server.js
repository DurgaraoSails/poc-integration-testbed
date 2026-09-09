/**
 * Serves the built Angular app on $PORT, and reverse-proxies /api/* to the `backend` sidecar.
 *
 * Three things an Angular build alone can't do, which is why this exists instead of a static host:
 *   1. `<base href>` must be the deployed path prefix, but a build is frozen before the prefix is
 *      known — so it's rewritten here, per request.
 *   2. The platform's config (and, in future, the signed-in user) arrive as request headers, so
 *      they can only be injected at request time.
 *   3. Sidecars are not externally addressable — only this ingress container can reach `backend`
 *      at all, so browser calls to /api/* have to be proxied through here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const template = readFileSync(join(dist, 'index.html'), 'utf8');

const PORT = process.env.PORT || 8080;
const BASE_PATH = process.env.BASE_PATH ?? '';
// SVC_BACKEND_URL is what the platform injects for a sidecar named "backend" (see poc.yaml);
// BACKEND_URL is a plain fallback for running this container directly, without the platform.
const BACKEND_URL = process.env.SVC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:8081';

// Angular resolves every asset and router URL against <base href>, and it must end in a slash —
// without the trailing slash the browser drops the last segment when resolving.
const BASE_HREF = BASE_PATH ? `${BASE_PATH.replace(/\/$/, '')}/` : '/';

/**
 * The complete set of values the browser is given — an allowlist, not a filtered dump of the
 * environment. `platformApiUrl` was here and is not any more: the browser never calls the platform
 * directly (file operations go through the backend sidecar), so shipping it served no purpose.
 *
 * `portalOrigin` has no wildcard fallback. An unset PORTAL_ORIGIN stays empty and the frontend
 * refuses to start the bridge, which is the guide §3 rule — a POC that will accept a session from
 * any origin is not a working POC in a degraded mode, it is an open one.
 */
const CONFIG = {
  basePath: BASE_PATH,
  portalOrigin: process.env.PORTAL_ORIGIN ?? '',
  slug: process.env.POC_SLUG ?? 'local-dev',
  version: process.env.POC_VERSION ?? 'dev',
};

/**
 * Startup validation, per guide §3. A misconfigured origin is not a smaller version of a working
 * POC — it is one that cannot decide who may hand it a session — so this refuses to start rather
 * than serving a shell that will either never handshake or handshake with anybody.
 *
 * The exception is an explicitly unset PORTAL_ORIGIN in local development, where the bridge's dev
 * harness stands in for the portal. That case still gets no CSP and no bridge; it just does not
 * take the whole container down.
 */
function validatePortalOrigin(value) {
  if (!value) {
    return { ok: false, fatal: false, reason: 'PORTAL_ORIGIN is not set' };
  }
  if (value === '*') {
    return { ok: false, fatal: true, reason: 'PORTAL_ORIGIN is "*", which is never a valid origin' };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, fatal: true, reason: `PORTAL_ORIGIN "${value}" is not a valid absolute URL` };
  }
  // A path, query or fragment means somebody passed a URL where an origin belongs, and there is no
  // safe way to guess what they meant. Anything else is normalised rather than rejected: a trailing
  // slash, an explicit :443, or an upper-case scheme all denote the same origin, and refusing to
  // boot over one would be a hostile way to treat a correct-but-differently-written value.
  //
  // Normalising is also what makes the comparison work at all. `event.origin` in the browser is
  // always the bare form, so keeping "https://portal.example.com/" verbatim would silently fail
  // every message check while looking configured.
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    return {
      ok: false,
      fatal: true,
      reason: `PORTAL_ORIGIN "${value}" must be a bare origin (scheme://host[:port]) with no path, query or fragment`,
    };
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    return { ok: false, fatal: true, reason: `PORTAL_ORIGIN "${value}" must use https outside local development` };
  }
  return { ok: true, origin: parsed.origin };
}

const ORIGIN_CHECK = validatePortalOrigin(CONFIG.portalOrigin);
if (ORIGIN_CHECK.fatal) {
  console.error(`refusing to start: ${ORIGIN_CHECK.reason}.`);
  process.exit(1);
}
if (!ORIGIN_CHECK.ok) {
  console.warn(
    `${ORIGIN_CHECK.reason} — serving without a frame-ancestors policy, and the bridge will not ` +
      'start. Expected in local development only.',
  );
} else if (ORIGIN_CHECK.origin !== CONFIG.portalOrigin) {
  console.log(`normalised PORTAL_ORIGIN "${CONFIG.portalOrigin}" to "${ORIGIN_CHECK.origin}"`);
  // The browser only ever reports the normalised form, so this is what must be compared against
  // and what must go into the CSP.
  CONFIG.portalOrigin = ORIGIN_CHECK.origin;
}

const app = express();

// Cloud Run's startup probe calls this directly on the container port — it never passes through
// the platform proxy, which is why this path is not prefixed.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Dumb byte-for-byte proxy: no body parsing, so JSON, multipart uploads and binary downloads all
// pass through unchanged. Registered before the static/SPA-fallback handlers below.
app.use('/api', express.raw({ type: () => true, limit: '15mb' }));
app.all('/api/*', async (req, res) => {
  const target = `${BACKEND_URL}${req.originalUrl}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  delete headers.connection;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error(`proxy to backend sidecar failed (${target}):`, err);
    res.status(502).json({ error: 'backend sidecar unreachable', detail: String(err) });
  }
});

// Hashed build artifacts are immutable and safe to cache hard; the shell is not (see below).
app.use(
  express.static(dist, {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
  }),
);

/**
 * Who may frame this POC, enforced by the browser rather than only by our own script.
 *
 * PORTAL_ORIGIN is the platform-injected origin of the portal that embeds us. The bridge already
 * checks it on every postMessage, but that only governs what we *talk to* — it does nothing to
 * stop a rogue page embedding this app and phishing a user in front of it. A deployed POC is
 * public (the platform deploys with --allow-unauthenticated, because the browser is the only
 * client and holds no Google identity token), so the URL being reachable by anyone is by design
 * and this header is what keeps it from being *embeddable* by anyone.
 *
 * Deliberately CSP rather than X-Frame-Options: the latter has no working allowlist form
 * (ALLOW-FROM is unsupported in modern browsers), so it could only ever say DENY or SAMEORIGIN —
 * both of which break the portal's iframe outright. That is the same header that produced the
 * original "refused to connect".
 *
 * With no PORTAL_ORIGIN set (local dev), no header is sent at all rather than a locked-down one,
 * so `ng serve` and a bare `docker run` keep working.
 */
function frameAncestorsFor(portalOrigin) {
  if (!portalOrigin || portalOrigin === '*') {
    return null;
  }
  return `frame-ancestors ${portalOrigin}`;
}

const FRAME_ANCESTORS = frameAncestorsFor(CONFIG.portalOrigin);

// SPA fallback. Per-request, so the injected config is always current.
app.get('*', (req, res) => {
  const html = template
    .replace(/<base href="[^"]*"\s*\/?>/, `<base href="${BASE_HREF}">`)
    .replace(
      '<!--SAILS_CONFIG-->',
      `<script>window.__SAILS__=${JSON.stringify(CONFIG).replace(/</g, '\\u003c')}</script>`,
    );

  if (FRAME_ANCESTORS) {
    res.setHeader('Content-Security-Policy', FRAME_ANCESTORS);
  }
  // The shell carries this deployment's runtime config, so a cached copy is how a POC ends up
  // talking to the previous environment's portal. Never store it.
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ${PORT} (base href ${BASE_HREF}, backend ${BACKEND_URL})`);
});
