import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="sails-card testbed-section">
      <h2>Chat</h2>
      <p class="sails-muted" style="margin-top:0">
        Static, predefined answers only — this proves the deploy pipeline, not an LLM.
      </p>

      <div class="testbed-file-list" style="max-height: 12rem; overflow-y: auto">
        @for (message of messages(); track $index) {
          <p style="margin: 0.15rem 0">
            <strong>{{ message.role === 'user' ? 'You' : 'Bot' }}:</strong> {{ message.text }}
          </p>
        }
      </div>

      <div class="testbed-row" style="margin-top: 0.75rem">
        <input
          class="sails-input"
          style="flex: 1; min-width: 14rem"
          placeholder="say hello, or ask about files / auth"
          [(ngModel)]="draft"
          (keydown.enter)="send()"
        />
        <button class="sails-btn" (click)="send()" [disabled]="sending() || !draft.trim()">
          {{ sending() ? 'Sending…' : 'Send' }}
        </button>
      </div>
      @if (error(); as message) {
        <p style="color: var(--sails-danger, #c0392b)">{{ message }}</p>
      }
    </section>
  `,
})
export class ChatPanel {
  protected draft = '';
  protected readonly messages = signal<ChatMessage[]>([
    { role: 'bot', text: "Hi! Ask me about files, auth, or say hello." },
  ]);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text) return;
    this.draft = '';
    this.messages.update((current) => [...current, { role: 'user', text }]);
    this.sending.set(true);
    this.error.set(null);
    try {
      // Relative on purpose: a leading-slash URL escapes BASE_PATH and 404s.
      const response = await fetch('api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as { reply: string };
      this.messages.update((current) => [...current, { role: 'bot', text: body.reply }]);
    } catch {
      this.error.set('Could not reach the chat backend.');
    } finally {
      this.sending.set(false);
    }
  }
}
