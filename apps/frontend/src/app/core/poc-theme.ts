import { Injectable, effect, inject } from '@angular/core';
import { PocBridge } from '@yateesha-pappala/poc-bridge/poc';

/**
 * Applies the portal's theme to `<html>`, live.
 *
 * `theme.css` declares the dark variant as `&:where(.dark, .dark *)`, so the whole design layer
 * follows a single class on the document element.
 *
 * Deliberately *not* the template's `core/theme.ts`. That service reads and writes
 * `localStorage`, and poc-template's own `PORTAL-INTEGRATION.md` states the portal and the
 * embedded app "don't currently sync across the iframe boundary" — a note that predates the
 * bridge. They do now: `portal:session` carries the initial theme and `portal:theme` carries
 * every later toggle, and the guide §5 requires both to apply without a reload.
 *
 * So the portal is the only source of truth here, and there is no persisted copy to disagree with
 * it. A stored preference would fight the next `portal:theme` on every reload; the `?theme=` query
 * parameter the previous implementation also read is gone for the same reason.
 *
 * Outside the portal the bridge reports its default ('light'), or whatever the dev harness was
 * started with — which is how dark mode gets exercised standalone.
 */
@Injectable({ providedIn: 'root' })
export class PocTheme {
  private readonly bridge = inject(PocBridge);

  constructor() {
    effect(() => {
      document.documentElement.classList.toggle('dark', this.bridge.theme() === 'dark');
    });
  }
}
