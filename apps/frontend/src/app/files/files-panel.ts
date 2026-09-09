import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';

interface FileMeta {
  id: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/**
 * Files are isolated by the platform: it derives both the user and the POC from the token this
 * POC's backend forwards, so there is no user or POC parameter to send — and no way for this
 * panel to ask for someone else's file by changing an ID.
 *
 * This component is created only while the bridge reports `ready` (see `app.ts`), so a terminated
 * session destroys it and the listing with it. That is what keeps a logged-out user from being
 * left looking at their file names, and it is why nothing here caches outside the component.
 */
@Component({
  selector: 'app-files-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="sui-card p-5">
      <h2 class="text-base font-semibold text-slate-900 dark:text-white">Files</h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Isolated to your user and this POC — the platform derives both from your token, not from
        anything this page sends.
      </p>

      <div class="testbed-row mt-4">
        <input #fileInput type="file" class="text-sm text-slate-600 dark:text-slate-300" (change)="upload()" />
        <button class="sui-btn sui-btn--outline" (click)="refresh()" [disabled]="loading()">
          {{ loading() ? 'Loading…' : 'Refresh list' }}
        </button>
      </div>

      @if (files().length) {
        <ul class="testbed-file-list">
          @for (file of files(); track file.id) {
            <li class="text-sm text-slate-700 dark:text-slate-200">
              <span>
                {{ file.originalFilename }} &middot; {{ formatSize(file.sizeBytes) }} &middot;
                {{ file.uploadedAt | date: 'short' }}
              </span>
              <span class="testbed-row">
                <button class="sui-btn sui-btn--outline sui-btn--sm" (click)="download(file)">
                  Download
                </button>
                <button class="sui-btn sui-btn--danger sui-btn--sm" (click)="remove(file)">
                  Delete
                </button>
              </span>
            </li>
          }
        </ul>
      } @else if (!loading()) {
        <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">No files yet for this user + POC.</p>
      }

      @if (error(); as message) {
        <p class="sui-error mt-3">{{ message }}</p>
      }
    </section>
  `,
})
export class FilesPanel implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly files = signal<FileMeta[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<FileMeta[]>('api/files').subscribe({
      next: (list) => {
        this.files.set(list);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(describeFileError(err, 'list your files'));
        this.loading.set(false);
      },
    });
  }

  protected upload(): void {
    const input = this.fileInput().nativeElement;
    const file = input.files?.[0];
    if (!file) return;

    this.error.set(null);
    const form = new FormData();
    // Exactly the field name the platform expects, and no explicit Content-Type: the browser has
    // to generate the multipart boundary itself.
    form.append('file', file);

    this.http.post('api/files', form).subscribe({
      next: () => {
        input.value = '';
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        input.value = '';
        this.error.set(describeFileError(err, `upload ${file.name}`));
      },
    });
  }

  protected download(file: FileMeta): void {
    this.error.set(null);
    // Fetched with the token on the request, then handed to the browser as a Blob URL — the guide
    // §7 rules out putting a credential in a download URL.
    this.http.get(`api/files/${file.id}/content`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.originalFilename;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => this.error.set(describeFileError(err, `download ${file.originalFilename}`)),
    });
  }

  protected remove(file: FileMeta): void {
    this.error.set(null);
    this.http.delete(`api/files/${file.id}`).subscribe({
      next: () => this.refresh(),
      error: (err: HttpErrorResponse) => this.error.set(describeFileError(err, `delete ${file.originalFilename}`)),
    });
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * The platform's file API distinguishes quota, size, type and ownership failures by status code,
 * and the guide §8/§13 asks for each to be understandable rather than collapsed into "HTTP 409".
 */
export function describeFileError(error: HttpErrorResponse, action: string): string {
  switch (error.status) {
    case 400:
      return `Could not ${action}: the file was rejected as invalid or an unsupported type.`;
    case 401:
      return `Could not ${action}: your session was not accepted. Reopen the POC from the portal.`;
    case 403:
      return `Could not ${action}: your access to this POC's files has been denied or has expired.`;
    case 404:
      return `Could not ${action}: that file no longer exists, or it is not yours.`;
    case 409:
      return `Could not ${action}: you have reached this POC's storage quota. Delete something first.`;
    case 413:
      return `Could not ${action}: the file is larger than the platform allows.`;
    case 0:
      return `Could not ${action}: the backend sidecar is unreachable.`;
    default:
      return `Could not ${action} (HTTP ${error.status}).`;
  }
}
