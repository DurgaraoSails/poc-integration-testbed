import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { PocBridge } from '@yateesha-pappala/poc-bridge/poc';

interface WhoAmI {
  verified: boolean;
  subject: string;
  audience: string[];
  issuer: string;
  expiresAt: string;
}

/**
 * Proves the round trip: the token the portal handed this iframe is accepted by this POC's own
 * backend after a real signature/issuer/audience check against the platform's JWKS.
 *
 * The manual token-paste field that used to live here is gone. It was a standalone bypass in
 * production code, which the guide §5 rules out; `startDevHarness()` in `main.ts` covers the
 * develop-outside-the-portal case it existed for, and only in a development build.
 *
 * Nothing renders the token itself. `bridge.user()` is display convenience carried on
 * `portal:session`; the authoritative identity is `subject` below, which came back from the
 * backend after verification.
 */
@Component({
  selector: 'app-auth-panel',
  standalone: true,
  imports: [JsonPipe],
  template: `
    <section class="sui-card p-5">
      <h2 class="text-base font-semibold text-slate-900 dark:text-white">Auth</h2>

      @if (bridge.user(); as user) {
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Signed in as <strong class="text-slate-900 dark:text-white">{{ user.displayName }}</strong>
          <span class="sui-badge sui-badge--success ml-2">session active</span>
        </p>
      }

      <div class="testbed-row mt-4">
        <button class="sui-btn sui-btn--primary" (click)="verify()" [disabled]="verifying()">
          {{ verifying() ? 'Verifying…' : 'Verify with backend' }}
        </button>
      </div>

      @if (verified(); as result) {
        <p class="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Backend verified the signature against the platform JWKS — subject
          <code>{{ result.subject }}</code>, audience <code>{{ result.audience.join(', ') }}</code>,
          issuer <code>{{ result.issuer }}</code>.
        </p>
        <pre
          class="scrollbar-subtle mt-3 overflow-x-auto rounded-md bg-gray-50 p-3 text-xs text-slate-700 dark:bg-brand-dark-panel dark:text-slate-200"
          >{{ result | json }}</pre
        >
      }

      @if (error(); as message) {
        <p class="sui-error mt-3">{{ message }}</p>
      }
    </section>
  `,
})
export class AuthPanel {
  protected readonly bridge = inject(PocBridge);
  private readonly http = inject(HttpClient);

  protected readonly verified = signal<WhoAmI | null>(null);
  protected readonly verifying = signal(false);
  protected readonly error = signal<string | null>(null);

  protected verify(): void {
    this.verifying.set(true);
    this.error.set(null);
    // Relative on purpose: resolved against <base href>, so one build works under any path prefix.
    this.http.get<WhoAmI>('api/session/whoami').subscribe({
      next: (result) => {
        this.verified.set(result);
        this.verifying.set(false);
      },
      error: (err: { status?: number }) => {
        this.verified.set(null);
        this.error.set(
          err.status === 401
            ? 'The backend rejected the token. Its signature, issuer or audience did not check out.'
            : 'Could not reach the backend sidecar.',
        );
        this.verifying.set(false);
      },
    });
  }
}
