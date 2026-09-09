/**
 * Local `ng serve` / `npm run dev`. Only effect: permits `startDevHarness()` in `src/main.ts`,
 * which fakes the portal's half of the handshake so the app renders without the real portal.
 * The harness mints nothing — it replays a real POC token you put in `localStorage` under
 * `dev.pocToken`, and the backend still verifies its signature, issuer and audience for real.
 */
export const environment = {
  production: false,
};
