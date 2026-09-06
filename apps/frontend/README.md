# frontend (ingress)

Angular 21, standalone components, signals, zoneless — matching the portal's own stack and the
`poc-platform-sdk` Angular starter this was built from.

```bash
npm install
npm run dev          # http://localhost:4200 — talks to nothing real; use docker-compose for that
```

Production is served by `server.js`, not a static host — see the comment at the top of that file
for why (path-prefix rewriting, and proxying `/api/*` to the `backend` sidecar, since sidecars
aren't reachable from the browser directly).

## Panels

- **Auth** — gets a POC-scoped JWT the way this actually has to work now that there's no gateway
  in front of a deployed POC: on load, this page posts `{type:'poc:ready'}` to `window.parent` and
  waits for the portal to answer with `{type:'portal:session', token}` (see
  `session.service.ts` for the full handshake, and self-service-portal's `poc-bridge.ts`/
  `poc-workspace.ts` for the other half of it). Not embedded in a portal iframe at all — local dev,
  a bare `docker run`? Paste a token by hand instead. "Verify with backend" sends whichever token
  you have to `backend`'s `/api/session/whoami`, which checks it against self-service-api's JWKS.
- **Chat** — static predefined replies, via `backend`'s `/api/chat`.
- **Files** — upload/list/download/delete, proxied through `backend` to self-service-api's
  `/poc-files` endpoints, using whatever token the Auth panel currently holds.

## Calling your own API

Keep fetch URLs relative (`fetch('api/session/whoami')`). A leading-slash URL escapes `BASE_PATH`
and 404s.
