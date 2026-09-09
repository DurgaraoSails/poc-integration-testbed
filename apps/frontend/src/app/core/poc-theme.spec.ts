import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PocBridge, type BridgeTheme } from '@yateesha-pappala/poc-bridge/poc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PocTheme } from './poc-theme';

/**
 * The portal owns the theme. These check that it reaches `<html>` on the initial session and on
 * every later toggle, and — the part a stored preference would break — that nothing else writes
 * it.
 */
describe('PocTheme', () => {
  const theme = signal<BridgeTheme>('light');

  function start(): void {
    TestBed.configureTestingModule({
      providers: [{ provide: PocBridge, useValue: { theme } }],
    });
    TestBed.inject(PocTheme);
    TestBed.tick();
  }

  beforeEach(() => {
    theme.set('light');
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('applies the session theme on startup', () => {
    theme.set('dark');
    start();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('starts light when the portal says light', () => {
    start();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows a live portal:theme change without a reload', () => {
    start();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    theme.set('dark');
    TestBed.tick();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    theme.set('light');
    TestBed.tick();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists nothing, so a reload cannot disagree with the portal', () => {
    start();
    theme.set('dark');
    TestBed.tick();

    expect(localStorage.getItem('theme')).toBeNull();
  });
});
