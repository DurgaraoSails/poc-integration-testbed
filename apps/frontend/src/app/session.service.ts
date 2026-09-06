import { Injectable, signal } from '@angular/core';

/**
 * Acquires the POC-scoped JWT self-service-api mints in `POST /pocs/{slug}/launch`, and holds it
 * in memory only — never localStorage/sessionStorage (self-service-portal-gateway's own bridge
 * contract calls that out explicitly, and it's good practice regardless).
 *
 * Two ways a token gets here:
 *  1. Deployed behind self-service-portal-gateway: a same-origin `GET /_portal/session-token`
 *     (the gateway owns that path; it never reaches this container) returns the current session's
 *     token, refreshed on every call.
 *  2. Anywhere else (local `ng serve`, a bare `docker run` with no gateway in front): that request
 *     simply won't resolve to anything meaningful, so this UI falls back to letting you paste a
 *     token by hand — e.g. one you copied from the portal's network tab, or minted by calling
 *     self-service-api's `/pocs/{slug}/launch` yourself while signed in as that user.
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

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly token = signal<string | null>(null);
  readonly source = signal<'gateway' | 'manual' | null>(null);
  readonly claims = signal<DecodedClaims | null>(null);
  readonly bootstrapping = signal(true);
  readonly verifiedClaims = signal<Record<string, unknown> | null>(null);
  readonly verifyError = signal<string | null>(null);
  readonly verifying = signal(false);

  async bootstrap(): Promise<void> {
    this.bootstrapping.set(true);
    try {
      const response = await fetch('_portal/session-token');
      if (response.ok) {
        const body = (await response.json()) as { accessToken?: string };
        if (body.accessToken) {
          this.setToken(body.accessToken, 'gateway');
        }
      }
    } catch {
      // Not running behind the gateway right now — that's expected in local dev.
    } finally {
      this.bootstrapping.set(false);
    }
  }

  setToken(token: string, source: 'gateway' | 'manual'): void {
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
