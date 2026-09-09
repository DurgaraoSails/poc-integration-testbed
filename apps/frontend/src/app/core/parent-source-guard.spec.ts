import { afterEach, describe, expect, it, vi } from 'vitest';

import { installParentSourceGuard } from './parent-source-guard';

const PORTAL = 'https://portal.example.com';

/**
 * The guard closes the gap the shipped bridge leaves: it checks `event.origin` but not
 * `event.source`, so a different window at the portal's origin can hand it a session. These
 * assert both halves of that — that such a message is stopped, and that legitimate traffic is
 * untouched.
 *
 * The `bridge` spy stands in for the library's own listener. It is registered *after* the guard,
 * which is the ordering `main.ts` guarantees by installing the guard before bootstrap, and the
 * whole reason `stopImmediatePropagation()` reaches it at all.
 */
describe('installParentSourceGuard', () => {
  const teardowns: Array<() => void> = [];

  function arrange() {
    const uninstall = installParentSourceGuard(PORTAL);
    const bridge = vi.fn();
    window.addEventListener('message', bridge);
    teardowns.push(uninstall, () => window.removeEventListener('message', bridge));
    return bridge;
  }

  afterEach(() => {
    teardowns.splice(0).forEach((fn) => fn());
  });

  it('blocks a portal-origin message from a window that is not our parent', () => {
    const bridge = arrange();

    // jsdom runs unframed, so `window.parent === window`; a null source is therefore any window
    // other than our parent — exactly the popup / sibling-iframe case.
    window.dispatchEvent(new MessageEvent('message', { origin: PORTAL, source: null }));

    expect(bridge).not.toHaveBeenCalled();
  });

  it('passes a portal-origin message that did come from our parent', () => {
    const bridge = arrange();

    window.dispatchEvent(
      new MessageEvent('message', { origin: PORTAL, source: window.parent as Window }),
    );

    expect(bridge).toHaveBeenCalledOnce();
  });

  it('leaves other origins alone for the bridge to ignore itself', () => {
    const bridge = arrange();

    window.dispatchEvent(
      new MessageEvent('message', { origin: 'https://evil.example.com', source: null }),
    );

    expect(bridge).toHaveBeenCalledOnce();
  });

  it('reports what it blocked, so a broken handshake is not silent in development', () => {
    const onBlocked = vi.fn();
    teardowns.push(installParentSourceGuard(PORTAL, onBlocked));

    window.dispatchEvent(
      new MessageEvent('message', { origin: PORTAL, source: null, data: { type: 'portal:session' } }),
    );

    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it('stops guarding once uninstalled', () => {
    const bridge = vi.fn();
    const uninstall = installParentSourceGuard(PORTAL);
    window.addEventListener('message', bridge);
    teardowns.push(() => window.removeEventListener('message', bridge));

    uninstall();
    window.dispatchEvent(new MessageEvent('message', { origin: PORTAL, source: null }));

    expect(bridge).toHaveBeenCalledOnce();
  });
});
