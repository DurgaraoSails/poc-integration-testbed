import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PocBridge } from '@yateesha-pappala/poc-bridge/poc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scopedPocBridgeInterceptor } from './poc-api';

/**
 * The wrapper's two jobs: keep the library's 401 handling, and stop it attaching the token to
 * anything but this POC's own API.
 *
 * The bridge is stubbed rather than started — a real handshake needs a portal. What is exercised
 * is the real library interceptor underneath the wrapper, which is where the refresh coalescing
 * and the one-retry bound actually live.
 */
describe('scopedPocBridgeInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let refresh: ReturnType<typeof vi.fn>;
  const token = signal<string | null>('token-1');

  beforeEach(() => {
    token.set('token-1');
    refresh = vi.fn(async () => {
      token.set('token-2');
      return 'token-2';
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([scopedPocBridgeInterceptor])),
        provideHttpClientTesting(),
        { provide: PocBridge, useValue: { token, refresh } },
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  it('attaches the token to this POC\'s own API', () => {
    http.get('/api/files').subscribe();

    const request = backend.expectOne('/api/files');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush([]);
    backend.verify();
  });

  it('does not attach the token to another host', () => {
    http.get('https://third-party.example.com/collect').subscribe();

    const request = backend.expectOne('https://third-party.example.com/collect');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
    backend.verify();
  });

  it('does not attach the token to public assets on our own origin', () => {
    http.get('/runtime-config.json').subscribe();

    const request = backend.expectOne('/runtime-config.json');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
    backend.verify();
  });

  it('renews once on a 401 and retries the request with the new token', async () => {
    const seen: unknown[] = [];
    http.get('/api/files').subscribe({ next: (value) => seen.push(value) });

    backend.expectOne('/api/files').flush('nope', { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    await Promise.resolve();

    const retry = backend.expectOne('/api/files');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer token-2');

    retry.flush([{ id: 1 }]);
    expect(seen).toHaveLength(1);
    backend.verify();
  });

  it('lets a second 401 propagate instead of looping', async () => {
    let failed: { status?: number } | null = null;
    http.get('/api/files').subscribe({ error: (error: { status?: number }) => (failed = error) });

    backend.expectOne('/api/files').flush('nope', { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    await Promise.resolve();

    backend.expectOne('/api/files').flush('nope', { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(failed).not.toBeNull();
    backend.verify();
  });

  it('does not renew on a 403 — that is an authorization answer, not a stale token', async () => {
    let failed: { status?: number } | null = null;
    http.get('/api/files').subscribe({ error: (error: { status?: number }) => (failed = error) });

    backend.expectOne('/api/files').flush('trial over', { status: 403, statusText: 'Forbidden' });
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    expect(failed).not.toBeNull();
    backend.verify();
  });

  it('does not renew on a 500', async () => {
    http.get('/api/files').subscribe({ error: () => undefined });

    backend.expectOne('/api/files').flush('boom', { status: 500, statusText: 'Server Error' });
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    backend.verify();
  });
});
