# poc-integration-testbed

A sample POC repo whose only job is to exercise the platform, not to be a real product: POC
authentication (JWT verification against the platform's JWKS), isolated per-user/per-POC file
management, and the ingress + sidecar deploy pipeline. Built against the real contracts, not a
mock.

```
poc.yaml                  ingress (frontend) + sidecar (backend), see below
apps/frontend/            Angular 21 — session gate, chat, files   (see apps/frontend/README.md)
apps/backend/             Spring Boot 4.1 — JWT verification, chat replies, files proxy
                                                                    (see apps/backend/README.md)
docker-compose.yml        run both containers locally against a real platform API
docs/ACCEPTANCE.md        what has actually been verified, and what has not
docs/INTEGRATION-HANDOFF.md   what the platform team needs to supply
```

## The four things this repo tests

| # | What | Where |
|---|---|---|
| 1 | Sample chatbot, static predefined answers | `apps/backend/.../chat/` + the Chat panel |
| 2 | File upload/list/download, isolated per user + POC | Files panel → `FilesProxyController` → the platform's `/poc-files` |
| 3 | Backend verifies incoming JWTs using the platform's public keys | `apps/backend/.../config/SecurityConfig.java` |
| 4 | `poc.yaml` models frontend as `ingress`, backend as `sidecar` | [`poc.yaml`](./poc.yaml) |

## Running it locally

You need a platform API running somewhere reachable, and a GitHub PAT with `read:packages` — the
portal bridge is a private package. Copy [`.env.example`](./.env.example) to `.env` first.

```bash
export NODE_AUTH_TOKEN=<GitHub PAT with read:packages>
docker compose up --build
```

To develop the frontend on its own, without the portal, use the bridge's dev harness — set
`localStorage['dev.pocToken']` to a real POC-scoped JWT and run `npm run dev`. It replays that
token; it mints nothing, and the backend still verifies it for real. There is no manual
token-paste field in the app any more: that was a standalone bypass sitting in production code.

## Tests

```bash
cd apps/backend && ./mvnw test
```

```bash
cd apps/frontend && npm test
```

38 backend, 40 frontend. [docs/ACCEPTANCE.md](./docs/ACCEPTANCE.md) maps them onto the integration
guide's §13 checklist and is explicit about the items that are **NOT RUN** — everything needing the
real portal, the real platform API, or a built container image.

## How identity reaches this POC

There is no proxy in front of a deployed POC and no gateway turning a `?token=` query param into a
cookie. Identity arrives one way only: the portal loads the POC in an iframe and hands it a
short-lived, POC-scoped JWT over `postMessage`; the POC sends that to its own backend as a bearer
token; the backend verifies it against the platform's JWKS and applies its own checks.

Both halves of that handshake come from **one** package —
[`@yateesha-pappala/poc-bridge`](https://github.com/Yateesha-Pappala/self-service-portal/tree/main/projects/poc-bridge)
`0.1.0`, which the portal's iframe host is also built from. This repo previously hand-rolled its
POC half; it no longer does, which removes a whole class of drift between the two implementations.

Two things the shipped `0.1.0` leaves to each POC, both flagged in the integration guide §6 and
both verified still open: it checks `event.origin` but not `event.source`, and its HTTP
interceptor attaches the token to *every* outgoing request. `apps/frontend/src/app/core/` closes
both, with tests, and both should be deleted if a later release absorbs them.

## Status and known gaps

Fully implemented and tested on the POC side; **nothing has been exercised against a real deployed
environment yet.** The blockers are all external, and are listed with what we need in
[docs/INTEGRATION-HANDOFF.md](./docs/INTEGRATION-HANDOFF.md). The short version:

- **A GitHub Packages read token is needed for every build**, including the container build. It is
  passed as a BuildKit secret so it never lands in an image layer, but whether the deploy pipeline
  can supply a build-time secret is an open question — guide §9 says that is not guaranteed.
- **`apps/frontend/package-lock.json` is stale** for the same reason: the install that would
  regenerate it cannot resolve the private package. Someone with a token needs to run
  `npm install` and commit it.
- **The JWT issuer and the portal origin need confirming per environment.** Both are now hard
  startup failures if wrong or missing, rather than silent misbehaviour.
- **`platform.files.enabled: true` provisions nothing.** The Files panel is untested against real
  `/poc-files` endpoints.

Two earlier entries in this section are now obsolete and have been removed: the multi-container
manifest pipeline is live (the platform API's in-process deployment implementation is the runtime
contract for this snapshot), and the bridge package is published rather than being source-only in
the portal repo.

## Design layer

The UI uses the shared `.sui-*` design layer vendored from `poc-template` (`apps/frontend/src/styles/`):
`theme.css` for tokens, `_branding.css` to rebrand, `components.css` for the component classes.
Dark mode is driven by the portal over the bridge — not by `localStorage`, which would fight the
portal on every reload. Note that `poc-template`'s own `PORTAL-INTEGRATION.md` still says the two
sides do not sync theme; that predates the bridge.
