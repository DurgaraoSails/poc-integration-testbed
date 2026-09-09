import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

/**
 * Canned answers, but an authenticated route: `/api/chat` executes work on request, which the
 * guide §1/§4 puts behind a verified token like any other compute endpoint. It used to be
 * `permitAll()` on the grounds that the replies are static — that reasoning does not survive the
 * contract, and it would not survive the bot being wired to a model later either.
 */
@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="sui-card p-5">
      <h2 class="text-base font-semibold text-slate-900 dark:text-white">Chat</h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Static, predefined answers — this proves the deploy pipeline, not an LLM.
      </p>

      <div class="scrollbar-subtle mt-3 max-h-48 overflow-y-auto">
        @for (message of messages(); track $index) {
          <p class="my-0.5 text-sm text-slate-700 dark:text-slate-200">
            <strong class="text-slate-900 dark:text-white">
              {{ message.role === 'user' ? 'You' : 'Bot' }}:
            </strong>
            {{ message.text }}
          </p>
        }
      </div>

      <div class="testbed-row mt-3">
        <input
          class="sui-input min-w-56 flex-1"
          placeholder="say hello, or ask about files / auth"
          [(ngModel)]="draft"
          (keydown.enter)="send()"
        />
        <button class="sui-btn sui-btn--primary" (click)="send()" [disabled]="sending() || !draft.trim()">
          {{ sending() ? 'Sending…' : 'Send' }}
        </button>
      </div>

      @if (error(); as message) {
        <p class="sui-error mt-3">{{ message }}</p>
      }
    </section>
  `,
})
export class ChatPanel {
  private readonly http = inject(HttpClient);

  protected draft = '';
  protected readonly messages = signal<ChatMessage[]>([
    { role: 'bot', text: 'Hi! Ask me about files, auth, or say hello.' },
  ]);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected send(): void {
    const text = this.draft.trim();
    if (!text) return;
    this.draft = '';
    this.messages.update((current) => [...current, { role: 'user', text }]);
    this.sending.set(true);
    this.error.set(null);

    this.http.post<{ reply: string }>('api/chat', { message: text }).subscribe({
      next: (body) => {
        this.messages.update((current) => [...current, { role: 'bot', text: body.reply }]);
        this.sending.set(false);
      },
      error: () => {
        this.error.set('Could not reach the chat backend.');
        this.sending.set(false);
      },
    });
  }
}
