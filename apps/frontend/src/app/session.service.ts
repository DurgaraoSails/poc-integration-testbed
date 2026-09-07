import { Injectable, signal } from '@angular/core';

import { BRIDGE_PROTOCOL_VERSION, SUPPORTED_BRIDGE_VERSIONS, sailsConfig } from './sails';

/**
 * Acquires the POC-scoped JWT self-service-api mints in `POST /pocs/{slug}/launch`, and holds it
 * in memory only — never localStorage/sessionStorage.
 *
 * There is no gateway or proxy sitting in front of a deployed POC anymore, so the only way the
 * token reaches this page at all is the portal handing it over directly, over `postMessage`, to
 * the iframe it's embedded in (see self-service-portal's `poc-bridge.ts` / `poc-workspace.ts`,
 * and `docs/specs/poc-bridge-contract.md`):
 *
 *  1. This page posts `{ type: 'poc:ready', v }` to `window.parent` once it's listening.
 *  2. The portal verifies it's really talking to this iframe, then posts back
 *     `{ type: 'portal:session', token, expiresAt, user, theme }`. `expiresAt` is an ISO-8601
 *     instant — the portal derives it from `/pocs/{slug}/launch`'s `expiresIn`, so the wire format
 *     is the bridge's, not the API's — and this schedules its own refresh from it. An earlier
 *     comment here said those fields were not sent and only `token` could be trusted; that was
 *     true of the portal's hand-rolled half, and stopped being true when `@sails/poc-bridge`
 *     landed.
 *  3. `PORTAL_ORIGIN` (injected by the platform, see `sails.ts`) is checked on every inbound
 *     message and used as the target on every outbound one — without it, any page that can frame
 *     this one could hand it a token. `event.source` is checked too, and any message whose
 *     protocol version this build does not list as supported is dropped rather than guessed at.
 *
 * Not embedded in an iframe at all (local `ng serve`, a bare `docker run`)? Then no parent will
 * ever answer `poc:ready`, so this UI falls back to letting you paste a token by hand — e.g. one
 * minted by calling self-service-api's `/pocs/{slug}/launch` yourself while signed in as that user.
 */
export interface DecodedClaims {
  sub?: string;
  aud?: string[] | string;
  iss?: string;
  exp?: number;
  pocId?: number;
  name?: string;
  [key: string]: unknown;
}

const BOOTSTRAP_TIMEOUT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly token = signal<string | null>(null);
  readonly source = signal<'bridge' | 'manual' | null>(null);
  readonly claims = signal<DecodedClaims | null>(null);
  readonly bootstrapping = signal(true);
  readonly verifiedClaims = signal<Record<string, unknown> | null>(null);
  readonly verifyError = signal<string | null>(null);
  readonly verifying = signal(false);
  /** Set when the portal says the session is over (logout, trial expiry) — terminal, not retryable. */
  readonly sessionEndedReason = signal<string | null>(null);

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  bootstrap(): void {
    this.bootstrapping.set(true);

    if (window.parent === window) {
      // Not embedded in anything — there's no portal to ask, so go straight to manual entry.
      this.bootstrapping.set(false);
      return;
    }

    window.addEventListener('message', this.onPortalMessage);
    this.postToParent({ type: 'poc:ready', v: BRIDGE_PROTOCOL_VERSION });

    // The portal may not exist, may be a different contract version, or may simply never answer
    // (see the known field-mismatch bug in self-service-portal referenced above) — don't leave
    // the UI stuck on "looking for a session" forever.
    setTimeout(() => {
      if (!this.token()) this.bootstrapping.set(false);
    }, BOOTSTRAP_TIMEOUT_MS);
  }

  /** Asks the portal to mint and hand over a fresh token — mirrors the `poc:refresh` message the
   *  real bridge contract defines for a near-expiry or 401'd token. */
  requestRefresh(): void {
    this.postToParent({ type: 'poc:refresh', v: BRIDGE_PROTOCOL_VERSION });
  }

  private postToParent(message: unknown): void {
    window.parent.postMessage(message, sailsConfig.portalOrigin === '*' ? '*' : sailsConfig.portalOrigin);
  }

  private onPortalMessage = (event: MessageEvent): void => {
    // Source before origin: a message from the right origin but the wrong window is still not the
    // portal we handed our readiness to.
    if (event.source !== window.parent) return;
    const expected = sailsConfig.portalOrigin;
    if (expected !== '*' && event.origin !== expected) return;

    const data = event.data as { type?: unknown; v?: unknown; token?: unknown; expiresAt?: unknown; reason?: unknown } | null;
    if (!data || typeof data !== 'object' || typeof data.v !== 'number') return;
    if (!SUPPORTED_BRIDGE_VERSIONS.includes(data.v)) return;

    if (data.type === 'portal:session' && typeof data.token === 'string') {
      this.setToken(data.token, 'bridge');
      this.bootstrapping.set(false);
      this.scheduleProactiveRefresh(typeof data.expiresAt === 'string' ? data.expiresAt : null);
      return;
    }

    // Terminal: the portal will not issue another token on this channel, so stop asking and drop
    // the one we hold rather than letting the UI look signed in until the token expires by itself.
    if (data.type === 'portal:session-ended') {
      this.sessionEndedReason.set(typeof data.reason === 'string' ? data.reason : 'error');
      this.clearRefreshTimer();
      this.clear();
      this.bootstrapping.set(false);
    }
  };

  /**
   * Refresh at 75% of the token's remaining life, the same point `@sails/poc-bridge` picks: early
   * enough that a slow round trip still lands before expiry, late enough not to mint tokens
   * needlessly. Without this the token simply expires mid-session and the next call 401s.
   */
  private scheduleProactiveRefresh(expiresAt: string | null): void {
    this.clearRefreshTimer();
    if (!expiresAt) return;

    const remainingMs = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;

    this.refreshTimer = setTimeout(() => this.requestRefresh(), remainingMs * 0.75);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  setToken(token: string, source: 'bridge' | 'manual'): void {
    this.token.set(token);
    this.source.set(source);
    this.claims.set(decodeJwtPayload(token));
    this.verifiedClaims.set(null);
    this.verifyError.set(null);
  }

  clear(): void {
    this.token.set(null);
    this.source.set(null);
    this.claims.set(null);
    this.verifiedClaims.set(null);
    this.verifyError.set(null);
  }

  /** Sends the token to this POC's own backend, which verifies it against self-service-api's
   *  JWKS. A 200 here is the "authentication actually works end to end" proof. */
  async verifyWithBackend(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.verifyError.set('No token to verify yet.');
      return;
    }
    this.verifying.set(true);
    try {
      const response = await fetch('api/session/whoami', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.text();
        this.verifyError.set(`Backend rejected the token (HTTP ${response.status}): ${body}`);
        this.verifiedClaims.set(null);
        return;
      }
      this.verifiedClaims.set(await response.json());
      this.verifyError.set(null);
    } catch {
      this.verifyError.set('Could not reach the backend sidecar.');
      this.verifiedClaims.set(null);
    } finally {
      this.verifying.set(false);
    }
  }
}

/** Decodes the payload for display only — this is never trusted for a security decision, it's
 *  just so you can see what you're about to send to the backend for real verification. */
function decodeJwtPayload(token: string): DecodedClaims | null {
  try {
    const [, payload] = token.split('.');
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as DecodedClaims;
  } catch {
    return null;
  }
}
