# frontend (ingress)

Angular 21, standalone components, signals, zoneless — matching the portal's own stack.

```bash
export NODE_AUTH_TOKEN=<GitHub PAT with read:packages>   # see "The bridge package" below
npm install
npm run dev          # http://localhost:4200
npm test
```

Production is served by `server.js`, not a static host — see the comment at the top of that file
for why (path-prefix rewriting, runtime config injection, and proxying `/api/*` to the `backend`
sidecar, since sidecars aren't reachable from the browser directly).

## The bridge package

The portal handshake is not hand-rolled here. It is
[`@yateesha-pappala/poc-bridge`](https://github.com/Yateesha-Pappala/self-service-portal/tree/main/projects/poc-bridge)
`0.1.0`, the same package the portal's own iframe host is built from, so both halves of the
protocol come from one source rather than two implementations that drift.

It is published to **GitHub Packages, not npmjs.com**, so `npm install` needs a token with
`read:packages`. `.npmrc` points the scope at the right registry and reads `NODE_AUTH_TOKEN`;
Docker takes the same value as a BuildKit secret so it never lands in an image layer:

```bash
DOCKER_BUILDKIT=1 docker build --secret id=npm_token,env=NODE_AUTH_TOKEN -t poc-frontend .
```

`app.config.ts` wires it up: `providePocBridge({ portalOrigin })` plus an app initializer on
`waitForSession()`, so Angular renders nothing until the handshake settles.

### What this repo adds on top of it

Two gaps the shipped `0.1.0` leaves to the POC, both named in the integration guide §6:

- **`core/parent-source-guard.ts`** — the library checks `event.origin` but not `event.source`, so
  origin alone would admit any *other* window at the portal's origin. The guard drops those before
  the library's listener sees them.
- **`core/poc-api.ts`** — the library's interceptor attaches `Authorization` to every outgoing
  request. `scopedPocBridgeInterceptor` narrows it to this POC's own `/api`, matched structurally
  by origin and path boundary rather than by string prefix.

Both have specs next to them. Both should disappear if a later release absorbs them.

## Session states

`app.ts` renders each of the bridge's five states, and the business panels exist only in `ready` —
so nothing can request data before there is a token, and a terminated session takes its UI with it.
The gate is `status() === 'ready'`, never "the initializer resolved": `waitForSession()` also
settles on failure.

| `status()` | What you see |
| --- | --- |
| `waiting` | Loading shell, no requests |
| `ready` | The Auth / Chat / Files panels |
| `not-embedded` | "Open this POC from the self-service portal" |
| `timed-out` | Recoverable error with a retry |
| `ended` | Logout / trial-expired / generic error, per `endedReason()` |

## Developing outside the portal

There is no manual token-paste field any more — that was a standalone bypass in production code.
Use the bridge's dev harness, which only exists in a development build:

```js
localStorage['dev.pocToken'] = '<a real POC-scoped JWT>';
```

then `npm run dev`. The harness fakes the portal's half of the handshake but mints nothing: the
token must be real, and the backend still verifies its signature, issuer and audience for real.
Mint one by calling the platform's `POST /pocs/{slug}/launch` while signed in as a portal user.

## Panels

- **Auth** — "Verify with backend" calls `backend`'s `/api/session/whoami`, which checks the token
  against the platform's JWKS. A 200 is the proof that the whole chain works.
- **Chat** — static predefined replies, via `backend`'s `/api/chat`.
- **Files** — upload/list/download/delete, proxied through `backend` to the platform's
  `/poc-files` endpoints. The platform derives both the user and the POC from the token, so there
  is nothing to send identifying either.

## Theme

The design layer is vendored from `poc-template` (`src/styles/`): `theme.css` for tokens,
`_branding.css` to rebrand, `components.css` for the `.sui-*` classes. `styles/README.md` is the
class reference. Only `_branding.css` is meant to be edited.

`core/poc-theme.ts` toggles `.dark` from `bridge.theme()`, so the portal's theme applies on
`portal:session` and on every later `portal:theme` without a reload. Deliberately not
poc-template's own `core/theme.ts`, which persists to `localStorage` — a stored preference would
fight the portal on every reload.

## Calling your own API

Keep URLs relative (`http.get('api/session/whoami')`). A leading-slash URL escapes `BASE_PATH`,
and the interceptor's allowlist resolves against `<base href>`.
