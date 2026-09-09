/**
 * Production build. `production: true` is what gates the bridge's dev harness off — see
 * `src/main.ts`. There is deliberately no `apiUrl` here: the browser always calls this POC's
 * own `/api` through the ingress proxy, resolved from `<base href>` at runtime, so no
 * environment-specific host is ever compiled into the bundle.
 */
export const environment = {
  production: true,
};
