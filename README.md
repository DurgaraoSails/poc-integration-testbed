# poc-integration-testbed

A sample POC repo whose only job is to exercise the platform, not to be a real product: POC
authentication (JWT verification against self-service-api's JWKS), isolated per-user/per-POC file
management, and the ingress + sidecar deploy pipeline. Built against the real contracts in
`self-service-api`, `self-service-portal-gateway`, and `poc-platform-sdk` — not a mock.

```
poc.yaml                  ingress (frontend) + sidecar (backend), see below
apps/frontend/            Angular 21 — chat UI, files UI, auth panel   (see apps/frontend/README.md)
apps/backend/             Spring Boot 4.1 — JWT verification, chat replies, files proxy
                                                                        (see apps/backend/README.md)
docker-compose.yml        run both containers locally against a real self-service-api
```

## The four things this repo tests

| # | What | Where |
|---|---|---|
| 1 | Sample chatbot, static predefined answers | `apps/backend/.../chat/` + the Chat panel in `apps/frontend` |
| 2 | Frontend file upload/list/download, isolated per user + POC | Files panel in `apps/frontend`, proxied through `apps/backend/.../files/FilesProxyController.java` to self-service-api's `/poc-files` |
| 3 | Backend verifies incoming JWTs using self-service-api's public keys | `apps/backend/.../config/SecurityConfig.java` — a real Spring OAuth2 resource server pointed at `GET /.well-known/jwks.json` |
| 4 | `poc.yaml` models frontend as `ingress`, backend as `sidecar` | [`poc.yaml`](./poc.yaml), validated against `poc-platform-sdk`'s `contract/poc.schema.json` |

## Running it locally

You need a `self-service-api` running somewhere reachable (default assumption: `localhost:8080`
on your host machine).

```bash
docker compose up --build
open http://localhost:8080
```

Without a token from the real gateway (see below), use the Auth panel's manual-entry field: mint
one by calling `self-service-api`'s `POST /pocs/{slug}/launch` while authenticated as a portal
user, and paste the resulting `token` in.

## Deploying it as an admin, via the portal

Push this repo to GitHub, then in self-service-portal: **Admin → Add POC**, giving it a slug and
this repo's `githubUrl`. See the caveats below before you do — as of this writing, deploying a
`poc.yaml` with more than one container isn't actually wired up yet.

## Current architecture (no gateway, no separate pipeline service)

`self-service-portal-gateway` and `poc-deploy-pipeline` are both deprecated. There is no proxy
sitting in front of a deployed POC anymore, and the build/deploy pipeline is moving into
`self-service-api` itself rather than living as a separate service. Two things follow from that:

1. **Identity only ever reaches a POC as a JWT, never as headers.** There's no proxy left to strip
   client-supplied `X-Sails-*` headers and set trustworthy ones in their place (which is the whole
   reason `poc-platform-sdk`'s contract could ever call that pattern safe). So this repo's backend
   verifying the JWT itself against self-service-api's JWKS isn't a testbed simplification — it's
   the only mechanism that currently exists for a POC to know who's calling it.
2. **The portal has to hand the token to the POC directly, over `postMessage`.** With no gateway to
   turn a `?token=` query param into a cookie, the only remaining path is the one
   self-service-portal's own `poc-bridge.ts`/`poc-workspace.ts` already implement: the POC's iframe
   posts `{type:'poc:ready'}` to its parent, and the portal posts back
   `{type:'portal:session', token}`. This repo's frontend (`session.service.ts`) implements the
   POC side of exactly that handshake — see `apps/frontend/README.md`.

## Known platform gaps this repo surfaces

- **The multi-container manifest pipeline isn't live yet.** As of this writing, nothing parses
  `poc.yaml` or builds more than a root `Dockerfile` — the `ManifestParser`/`ManifestValidator`
  classes `poc-platform-sdk`'s contract describes only exist on `self-service-api`'s
  `feature/sidecar-deployment` branch. This repo's `poc.yaml` is written to `poc-platform-sdk`'s
  schema exactly so it's ready the moment that support lands inside `self-service-api` — that's the
  point of it — but deploying this repo *today* will very likely either fail to find a root
  `Dockerfile` or only build one of the two containers, depending on how far along that work is.
- **self-service-portal's launch response doesn't match self-service-api's actual response shape
  — and now that there's no gateway, this is a harder blocker than it used to be.** The portal's
  `PocLaunchResponse` TypeScript interface expects `expiresAt`, `appUrl`, `user`, and `theme`; the
  real backend (`PocLaunchController`/`PocLaunchService`) returns
  `{ token, expiresIn, launchUrl, pocId, slug }` — no `user`, no `theme`, and different names for
  the other two. `poc-workspace.ts` sets the launch iframe's `src` from the now-`undefined`
  `response.appUrl`, so the iframe may never even load, and separately, whatever `poc-bridge.ts`
  posts as `portal:session` needs to actually carry a `token` field pulled from the real response
  for this repo's bridge handshake to receive anything. Worth fixing in `self-service-portal`
  independently of this repo — it isn't something a POC-side change can work around. This repo's
  Auth panel supports pasting a token by hand specifically so pieces 1–3 stay testable while that's
  outstanding.
- **CORS**: file calls are proxied through the `backend` sidecar rather than called directly from
  the browser specifically so this doesn't depend on self-service-api allowing cross-origin
  requests from arbitrary POC origins. If you change that later, check self-service-api's CORS
  config first.

None of the above blocks testing pieces 1–3 independently (chat, file management via the backend
proxy, and JWT verification all work standalone via docker-compose and a manually-pasted token);
it's specifically end-to-end testing through the portal's real iframe launch, and multi-container
deploys, that are gated on the items above landing elsewhere.
