import { bootstrapApplication } from '@angular/platform-browser';
import { startDevHarness } from '@yateesha-pappala/poc-bridge/poc';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { installParentSourceGuard } from './app/core/parent-source-guard';
import { readPortalOrigin, runtimeConfig } from './app/core/runtime-config';
import { environment } from './environments/environment';

/**
 * Bootstrap order matters here, in three places:
 *
 *  1. The dev harness must start before the bridge does, because it is what lets the bridge talk
 *     at all on a page nothing has framed.
 *  2. The parent-source guard must be installed before the bridge registers its own listener, so
 *     that it runs first and can drop a message before the bridge reads it.
 *  3. The portal origin is validated before Angular starts. `providePocBridge` throws on a
 *     missing or wildcard origin — correct, but a thrown provider is a blank page, and the guide
 *     §5 requires every failure to be visible and readable.
 */

/** A real POC token, pasted into devtools once: `localStorage.dev.pocToken = '<jwt>'`. */
const DEV_TOKEN_KEY = 'dev.pocToken';

function readDevToken(): string | null {
  if (environment.production) {
    return null;
  }
  try {
    return localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Rendered instead of the app when `PORTAL_ORIGIN` is missing or malformed. A deployment in that
 * state cannot safely complete a handshake, so it says so rather than showing a spinner that will
 * never resolve.
 */
function renderConfigurationError(): void {
  const root = document.querySelector('app-root');
  if (!root) {
    return;
  }
  root.innerHTML = `
    <div class="mx-auto max-w-2xl p-8">
      <div class="sui-card p-6">
        <h1 class="text-lg font-semibold text-slate-900 dark:text-white">POC is not configured</h1>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
          PORTAL_ORIGIN is missing or is not a bare origin, so this POC cannot verify who is
          allowed to hand it a session. It will not start until the deployment supplies one.
        </p>
        <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Expected something like <code>https://portal.example.com</code> — no path, no wildcard.
        </p>
      </div>
    </div>`;
}

const devToken = readDevToken();

if (devToken) {
  // The harness answers this window's own `poc:ready`, so the origin it and the bridge agree on
  // is this page's. It mints nothing: `devToken` must be a real POC-scoped JWT, and the backend
  // verifies its signature, issuer and audience exactly as it would in production.
  startDevHarness({ token: devToken, portalOrigin: window.location.origin });
}

const portalOrigin = devToken
  ? window.location.origin
  : readPortalOrigin(runtimeConfig.portalOrigin);

if (!portalOrigin) {
  renderConfigurationError();
} else {
  installParentSourceGuard(portalOrigin, (event) => {
    if (!environment.production) {
      console.warn(
        `[poc] dropped a ${String((event.data as { type?: unknown })?.type ?? 'message')} from ` +
          `${event.origin}: right origin, wrong window. Only the frame that embedded this POC ` +
          `may send it a session.`,
      );
    }
  });

  bootstrapApplication(App, appConfig(portalOrigin)).catch((err) => console.error(err));
}
