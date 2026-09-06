import { Component, inject } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SessionService } from '../session.service';

@Component({
  selector: 'app-auth-panel',
  standalone: true,
  imports: [FormsModule, JsonPipe],
  template: `
    <section class="sails-card testbed-section">
      <h2>Auth</h2>

      @if (session.bootstrapping()) {
        <p class="sails-muted">Looking for a session behind the gateway…</p>
      } @else if (session.token()) {
        <p class="sails-muted" style="margin-top:0">
          Token source: <strong>{{ session.source() }}</strong>
          @if (session.claims(); as claims) {
            &middot; sub <code>{{ claims['sub'] }}</code>
            &middot; aud <code>{{ claims['aud'] }}</code>
          }
        </p>
        <div class="testbed-row">
          <button class="sails-btn" (click)="session.verifyWithBackend()" [disabled]="session.verifying()">
            {{ session.verifying() ? 'Verifying…' : 'Verify with backend' }}
          </button>
          <button class="sails-btn sails-btn--secondary" (click)="session.clear()">Clear token</button>
        </div>

        @if (session.verifiedClaims(); as verified) {
          <pre class="sails-scrollbar-subtle" style="margin-top:1rem; overflow-x:auto">{{ verified | json }}</pre>
        }
        @if (session.verifyError(); as error) {
          <p style="color: var(--sails-danger, #c0392b)">{{ error }}</p>
        }
      } @else {
        <p class="sails-muted" style="margin-top:0">
          No session token yet. If this POC isn't running behind
          self-service-portal-gateway right now, paste one you minted or copied manually.
        </p>
        <div class="testbed-row">
          <input
            class="sails-input"
            style="flex: 1; min-width: 16rem"
            placeholder="paste a POC-scoped JWT"
            [(ngModel)]="manualToken"
          />
          <button class="sails-btn" (click)="useManualToken()" [disabled]="!manualToken.trim()">
            Use token
          </button>
        </div>
      }
    </section>
  `,
})
export class AuthPanel {
  protected readonly session = inject(SessionService);
  protected manualToken = '';

  protected useManualToken(): void {
    const token = this.manualToken.trim();
    if (!token) return;
    this.session.setToken(token, 'manual');
  }
}
