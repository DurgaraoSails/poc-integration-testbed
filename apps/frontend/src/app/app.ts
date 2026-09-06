import { Component, inject, OnInit } from '@angular/core';

import { AuthPanel } from './auth/auth-panel';
import { ChatPanel } from './chat/chat-panel';
import { FilesPanel } from './files/files-panel';
import { Sails } from './sails';
import { SessionService } from './session.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AuthPanel, ChatPanel, FilesPanel],
  template: `
    <div class="testbed-grid">
      <header>
        <h1 style="margin: 0 0 0.25rem; font-size: 1.5rem">{{ sails.config.slug }}</h1>
        <p class="sails-muted" style="margin: 0">
          POC integration testbed — exercises POC authentication, isolated file storage, and the
          ingress/sidecar deploy pipeline.
        </p>
        <button
          class="sails-btn sails-btn--secondary"
          style="margin-top: 0.75rem"
          (click)="sails.toggleDark()"
        >
          Toggle dark (local test)
        </button>
      </header>

      <app-auth-panel />
      <app-chat-panel />
      <app-files-panel />
    </div>
  `,
})
export class App implements OnInit {
  protected readonly sails = inject(Sails);
  private readonly session = inject(SessionService);

  ngOnInit(): void {
    this.session.bootstrap();
  }
}
