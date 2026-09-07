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

const CONFIG = {
  basePath: BASE_PATH,
  platformApiUrl: process.env.PLATFORM_API_URL ?? '',
  portalOrigin: process.env.PORTAL_ORIGIN ?? '*',
  slug: process.env.POC_SLUG ?? 'local-dev',
  version: process.env.POC_VERSION ?? 'dev',
};

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

app.use(express.static(dist, { index: false }));

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
  return `frame-ancestors 'self' ${portalOrigin}`;
}

const FRAME_ANCESTORS = frameAncestorsFor(CONFIG.portalOrigin);

// SPA fallback. Per-request, so the injected config is always current.
app.get('*', (req, res) => {
  const html = template
    .replace(/<base href="[^"]*"\s*\/?>/, `<base href="${BASE_HREF}">`)
    .replace(
      '<!--SAILS_CONFIG-->',
      `<script>window.__SAILS__=${JSON.stringify({ ...CONFIG, user: { id: null, email: null } }).replace(/</g, '\\u003c')}</script>`,
    );

  if (FRAME_ANCESTORS) {
    res.setHeader('Content-Security-Policy', FRAME_ANCESTORS);
  }
  res.type('html').send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ${PORT} (base href ${BASE_HREF}, backend ${BACKEND_URL})`);
});
