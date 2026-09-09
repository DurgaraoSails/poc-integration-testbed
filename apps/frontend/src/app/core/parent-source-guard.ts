/**
 * Drops portal-origin messages that did not come from the window that framed us.
 *
 * `@yateesha-pappala/poc-bridge@0.1.0` checks `event.origin` but not `event.source` (verified
 * against the shipped bundle: its `onMessage` compares origin only). The integration guide §5
 * requires both — "require `event.origin === configuredPortalOrigin` and `event.source ===
 * window.parent`" — and §6 names this exact omission as one a POC must close locally.
 *
 * Without the source check, origin alone admits any *other* window at the portal's origin: a
 * popup the portal opened, or a sibling iframe on a portal page. Either could hand this POC a
 * session token it would then treat as the portal's.
 *
 * Implemented as a capture-phase listener rather than a fork of the library. For an event
 * dispatched at `window`, listeners on `window` run in registration order, so installing this
 * before the bridge starts puts it first; `stopImmediatePropagation()` then prevents the bridge's
 * own listener from ever seeing the message. That keeps the package a plain dependency, and the
 * guard disappears on its own once a release adds the check upstream.
 *
 * Only traffic from the configured portal origin is touched. Everything else is somebody else's
 * message on a shared bus and is left alone for the bridge to ignore in silence.
 */
export function installParentSourceGuard(
  portalOrigin: string,
  onBlocked?: (event: MessageEvent) => void,
): () => void {
  const guard = (event: MessageEvent): void => {
    if (event.origin !== portalOrigin) {
      return;
    }
    // `window.parent === window` when this page is not framed, which is how the bridge's own dev
    // harness talks to it: it posts to this same window, so source and parent match and the
    // message passes.
    if (event.source === window.parent) {
      return;
    }
    event.stopImmediatePropagation();
    onBlocked?.(event);
  };

  window.addEventListener('message', guard, true);
  return () => window.removeEventListener('message', guard, true);
}
