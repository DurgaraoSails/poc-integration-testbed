import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  PocBridge,
  type BridgeUser,
  type PocBridgeStatus,
  type SessionEndedReason,
} from '@yateesha-pappala/poc-bridge/poc';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from './app';

/**
 * The session gate.
 *
 * The assertion that matters in every non-ready case is the *absence* of the business panels: a
 * panel that exists is a panel that can fire a request, and the whole point of gating on
 * `status()` is that nothing loads before there is a token or after the session has gone.
 */
describe('App', () => {
  const status = signal<PocBridgeStatus>('waiting');
  const endedReason = signal<SessionEndedReason | null>(null);
  const user = signal<BridgeUser | null>(null);
  const theme = signal<'light' | 'dark'>('light');

  let fixture: ComponentFixture<App>;

  function render(): HTMLElement {
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    status.set('waiting');
    endedReason.set(null);
    user.set(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PocBridge,
          useValue: { status, endedReason, user, theme, token: signal<string | null>('t'), refresh: async () => 't' },
        },
      ],
    });
  });

  it('shows a loading shell and no business panels while waiting', () => {
    const el = render();

    expect(el.textContent).toContain('Connecting to the portal');
    expect(el.querySelector('app-files-panel')).toBeNull();
    expect(el.querySelector('app-chat-panel')).toBeNull();
    expect(el.querySelector('app-auth-panel')).toBeNull();
  });

  it('tells a directly-opened POC to come in through the portal, with no way past it', () => {
    status.set('not-embedded');
    const el = render();

    expect(el.textContent).toContain('Open this POC from the self-service portal');
    expect(el.querySelector('app-files-panel')).toBeNull();
    // The manual token-paste bypass that used to live in the Auth panel must not reappear.
    expect(el.querySelector('input')).toBeNull();
  });

  it('shows a recoverable message when the handshake times out, not a spinner', () => {
    status.set('timed-out');
    const el = render();

    expect(el.textContent).toContain('The portal did not respond');
    expect(el.querySelector('button')?.textContent).toContain('Try again');
    expect(el.querySelector('app-files-panel')).toBeNull();
  });

  it('clears the business UI on logout', () => {
    status.set('ended');
    endedReason.set('logout');
    const el = render();

    expect(el.textContent).toContain('You have been signed out');
    expect(el.querySelector('app-files-panel')).toBeNull();
  });

  it('names an expired trial specifically', () => {
    status.set('ended');
    endedReason.set('trial-expired');
    const el = render();

    expect(el.textContent).toContain('Your trial has ended');
    expect(el.querySelector('app-files-panel')).toBeNull();
  });

  it('falls back to a generic session error', () => {
    status.set('ended');
    endedReason.set('error');
    const el = render();

    expect(el.textContent).toContain('Session error');
    expect(el.querySelector('app-files-panel')).toBeNull();
  });

  it('renders the business panels only once ready', () => {
    status.set('ready');
    user.set({ id: 'u1', displayName: 'Test User' });
    const el = render();

    expect(el.querySelector('app-auth-panel')).not.toBeNull();
    expect(el.querySelector('app-chat-panel')).not.toBeNull();
    expect(el.querySelector('app-files-panel')).not.toBeNull();
    expect(el.textContent).toContain('Test User');

    // The files panel loads on init — that request is only legitimate because we are ready.
    TestBed.inject(HttpTestingController).expectOne('api/files').flush([]);
  });

  it('tears the business panels down when a ready session ends', () => {
    status.set('ready');
    user.set({ id: 'u1', displayName: 'Test User' });
    const el = render();
    TestBed.inject(HttpTestingController).expectOne('api/files').flush([{ id: 1, originalFilename: 'secret.pdf' }]);
    fixture.detectChanges();
    expect(el.textContent).toContain('secret.pdf');

    status.set('ended');
    endedReason.set('logout');
    fixture.detectChanges();

    expect(el.querySelector('app-files-panel')).toBeNull();
    expect(el.textContent).not.toContain('secret.pdf');
  });
});
