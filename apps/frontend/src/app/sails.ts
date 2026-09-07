import { Injectable, signal } from '@angular/core';

/** Injected into index.html by server.js at request time. */
export interface SailsConfig {
  basePath: string;
  platformApiUrl: string;
  portalOrigin: string;
  slug: string;
  version: string;
  user: { id: string | null; email: string | null };
}

declare global {
  interface Window {
    __SAILS__?: SailsConfig;
  }
}

/**
 * Bridge protocol versions this POC understands, mirroring `@sails/poc-bridge`'s
 * `SUPPORTED_VERSIONS`. A literal list, never derived from a single "current" constant: a POC is
 * deployed on its own schedule and may run older or newer than the portal, so accepting the
 * current version and the one before it is what keeps a portal release from cutting every
 * deployed POC off at once.
 */
export const SUPPORTED_BRIDGE_VERSIONS: readonly number[] = [1];

/** The version this build stamps on everything it sends. */
export const BRIDGE_PROTOCOL_VERSION = 1;

const FALLBACK: SailsConfig = {
  basePath: '',
  platformApiUrl: '',
  portalOrigin: '*',
  slug: 'local-dev',
  version: 'dev',
  user: { id: null, email: null },
};

/** Read once at module load so `APP_BASE_HREF` can be provided before the app bootstraps. */
export const sailsConfig: SailsConfig = window.__SAILS__ ?? FALLBACK;

@Injectable({ providedIn: 'root' })
export class Sails {
  readonly config = sailsConfig;

  private readonly darkMode = signal(
    new URLSearchParams(location.search).get('theme') === 'dark',
  );

  /** Mirrors the portal's own Theme service: a signal driving a class on documentElement. */
  readonly isDark = this.darkMode.asReadonly();

  constructor() {
    this.apply();
    this.linkTheme();
    this.followPortal();
  }

  private apply(): void {
    document.documentElement.classList.toggle('sails-dark', this.darkMode());
  }

  /**
   * Linked from the platform rather than vendored, so a token change reaches every POC without
   * any of them rebuilding.
   */
  private linkTheme(): void {
    if (!this.config.platformApiUrl) return; // local dev without the platform
    const href = `${this.config.platformApiUrl}/assets/theme/v1/theme.css`;
    if (document.querySelector(`link[href="${href}"]`)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  /**
   * An iframe cannot inherit the parent's theme class, so the portal hands it over: on
   * `portal:session` when the session is established, and again on `portal:theme` each time the
   * user toggles. The `?theme=` query param this class also reads is a leftover from before the
   * bridge existed — the portal no longer appends it, so `portal:session` is what actually decides
   * the initial theme now. It is kept only for opening this app directly outside the portal.
   *
   * <p>The message names come from `@sails/poc-bridge`'s protocol, not from this repo: the portal
   * sends `portal:theme` carrying `theme`, and the theme is repeated on `portal:session` so a POC
   * that connects mid-session starts on the right one. This listener previously waited for
   * `sails:theme` carrying `mode` — a name that never existed on the portal side — so the toggle
   * silently did nothing here. That is exactly the two-hand-rolled-halves drift the shared package
   * exists to prevent; this stays hand-rolled only until the package is published.
   */
  private followPortal(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      // Only the frame that embedded us, and only from the origin the platform named. Without
      // both checks, any page that can frame this one could drive its UI.
      if (event.source !== window.parent) return;
      if (this.config.portalOrigin !== '*' && event.origin !== this.config.portalOrigin) return;

      const data = event.data as { type?: unknown; v?: unknown; theme?: unknown } | null;
      if (!data || typeof data !== 'object' || typeof data.v !== 'number') return;
      // A version this build cannot interpret is dropped rather than guessed at.
      if (!SUPPORTED_BRIDGE_VERSIONS.includes(data.v)) return;
      if (data.type !== 'portal:theme' && data.type !== 'portal:session') return;
      if (data.theme !== 'light' && data.theme !== 'dark') return;

      this.darkMode.set(data.theme === 'dark');
      this.apply();
    });
  }

  /** Local-only toggle, for developing outside the portal. */
  toggleDark(): void {
    this.darkMode.set(!this.darkMode());
    this.apply();
  }
}
