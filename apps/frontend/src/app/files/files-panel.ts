import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';

import { SessionService } from '../session.service';

interface FileMeta {
  id: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

@Component({
  selector: 'app-files-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="sails-card testbed-section">
      <h2>Files</h2>
      <p class="sails-muted" style="margin-top:0">
        Isolated to your user and this POC — self-service-api derives both from your token, not
        from anything this page sends.
      </p>

      @if (!session.token()) {
        <p class="sails-muted">Get a session token in the Auth panel above first.</p>
      } @else {
        <div class="testbed-row">
          <input #fileInput type="file" (change)="onFileSelected()" />
          <button class="sails-btn" (click)="refresh()" [disabled]="loading()">
            {{ loading() ? 'Loading…' : 'Refresh list' }}
          </button>
        </div>

        @if (files().length) {
          <ul class="testbed-file-list">
            @for (file of files(); track file.id) {
              <li>
                <span>{{ file.originalFilename }} &middot; {{ formatSize(file.sizeBytes) }} &middot; {{ file.uploadedAt | date: 'short' }}</span>
                <span class="testbed-row">
                  <button class="sails-btn sails-btn--secondary" (click)="download(file)">Download</button>
                  <button class="sails-btn sails-btn--secondary" (click)="remove(file)">Delete</button>
                </span>
              </li>
            }
          </ul>
        } @else if (!loading()) {
          <p class="sails-muted">No files yet for this user + POC.</p>
        }

        @if (error(); as message) {
          <p style="color: var(--sails-danger, #c0392b)">{{ message }}</p>
        }
      }
    </section>
  `,
})
export class FilesPanel {
  protected readonly session = inject(SessionService);
  protected readonly files = signal<FileMeta[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  private headers(): HeadersInit {
    return { Authorization: `Bearer ${this.session.token()}` };
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await fetch('api/files', { headers: this.headers() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.files.set((await response.json()) as FileMeta[]);
    } catch {
      this.error.set('Could not list files.');
    } finally {
      this.loading.set(false);
    }
  }

  async onFileSelected(): Promise<void> {
    const input = this.fileInput().nativeElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('api/files', {
        method: 'POST',
        headers: this.headers(),
        body: form,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      input.value = '';
    }
  }

  async download(file: FileMeta): Promise<void> {
    this.error.set(null);
    try {
      const response = await fetch(`api/files/${file.id}/content`, { headers: this.headers() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.originalFilename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      this.error.set('Download failed.');
    }
  }

  async remove(file: FileMeta): Promise<void> {
    this.error.set(null);
    try {
      const response = await fetch(`api/files/${file.id}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.refresh();
    } catch {
      this.error.set('Delete failed.');
    }
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
