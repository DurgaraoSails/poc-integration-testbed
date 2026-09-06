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
   * An iframe cannot inherit the parent's theme class, so the portal hands it over twice: as a
   * query param on first load (no flash of the wrong theme), then by postMessage on each toggle.
   */
  private followPortal(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      // Without this origin check, any page that can frame you could drive your UI.
      if (this.config.portalOrigin !== '*' && event.origin !== this.config.portalOrigin) return;
      if (event.data?.type === 'sails:theme') {
        this.darkMode.set(event.data.mode === 'dark');
        this.apply();
      }
    });
  }

  /** Local-only toggle, for developing outside the portal. */
  toggleDark(): void {
    this.darkMode.set(!this.darkMode());
    this.apply();
  }
}
