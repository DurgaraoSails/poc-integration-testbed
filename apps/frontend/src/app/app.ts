import { Component, computed, inject } from '@angular/core';
import { PocBridge } from '@yateesha-pappala/poc-bridge/poc';

import { AuthPanel } from './auth/auth-panel';
import { ChatPanel } from './chat/chat-panel';
import { FilesPanel } from './files/files-panel';
import { runtimeConfig } from './core/runtime-config';

/**
 * The session gate. Every state in the integration guide §5's table is rendered here, and the
 * business panels exist in the DOM only in `ready` — so a component cannot fire a data request
 * before there is a token, and a terminated session removes its UI rather than leaving it on
 * screen with a dead token behind it.
 *
 * The condition is `status() === 'ready'`, never "the app initializer resolved". `waitForSession()`
 * settles on terminal failures too, so treating its resolution as authentication would render the
 * authenticated UI on a timed-out handshake — the trap §6 warns about.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AuthPanel, ChatPanel, FilesPanel],
  template: `
    <div class="testbed-grid">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-white">
          {{ slug }}
        </h1>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          POC integration testbed — exercises POC authentication, isolated file storage, and the
          ingress/sidecar deploy pipeline.
        </p>
      </header>

      @switch (bridge.status()) {
        @case ('ready') {
          <app-auth-panel />
          <app-chat-panel />
          <app-files-panel />
        }

        @case ('waiting') {
          <section class="sui-card p-6" aria-busy="true">
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">
              Connecting to the portal…
            </h2>
            <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Announced <code>poc:ready</code>; waiting for a session. No data is loaded until one
              arrives.
            </p>
          </section>
        }

        @case ('not-embedded') {
          <section class="sui-card p-6">
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">
              Open this POC from the self-service portal
            </h2>
            <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
              It runs inside the portal's workspace, which is what supplies its session. There is
              no standalone sign-in.
            </p>
          </section>
        }

        @case ('timed-out') {
          <section class="sui-card p-6">
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">
              The portal did not respond
            </h2>
            <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
              No session arrived before the handshake timed out, so nothing has been loaded.
              Reloading the workspace usually clears it.
            </p>
            <button class="sui-btn sui-btn--primary mt-4" (click)="reload()">Try again</button>
          </section>
        }

        @case ('ended') {
          <section class="sui-card p-6">
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">
              {{ endedTitle() }}
            </h2>
            <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">{{ endedDetail() }}</p>
          </section>
        }
      }
    </div>
  `,
})
export class App {
  protected readonly bridge = inject(PocBridge);
  protected readonly slug = runtimeConfig.slug;

  protected readonly endedTitle = computed(() => {
    switch (this.bridge.endedReason()) {
      case 'logout':
        return 'You have been signed out';
      case 'trial-expired':
        return 'Your trial has ended';
      default:
        return 'Session error';
    }
  });

  protected readonly endedDetail = computed(() => {
    switch (this.bridge.endedReason()) {
      case 'logout':
        return 'This session is closed. Reopen the POC through the portal to start a new one.';
      case 'trial-expired':
        return 'Trial access to this POC has ended. Contact your administrator to extend it.';
      default:
        return 'The session ended unexpectedly and protected work has stopped. Reopen the POC ' +
          'through the portal to try again.';
    }
  });

  protected reload(): void {
    window.location.reload();
  }
}
