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

## Known platform gaps this repo surfaces

Building this surfaced a few things worth knowing before you rely on a clean end-to-end test:

- **The multi-container pipeline isn't live yet.** `poc-deploy-pipeline` (as of commit `a838970`)
  and the mainline of `self-service-api` (branch `feature/multipoc-deploy`) don't parse `poc.yaml`
  or build more than the root `Dockerfile` — the `ManifestParser`/`ManifestValidator` classes
  `poc-platform-sdk`'s contract describes only exist on `self-service-api`'s
  `feature/sidecar-deployment` branch, and nothing in `poc-deploy-pipeline` references them yet.
  This repo's `poc.yaml` is written to `poc-platform-sdk`'s schema exactly so it's ready the moment
  that support lands — that's the point of it — but deploying it *today* will very likely either
  fail to find a root `Dockerfile` or only build one of the two containers, depending on how far
  along that work is when you try it.
- **self-service-portal-gateway doesn't inject `X-Sails-*` identity headers yet.** `poc-platform-sdk`'s
  contract describes reading identity from `X-Sails-User-Id` etc., but the gateway's
  `SessionAuthFilter` (as of commit history at the time this was written) only validates a cookie
  and proxies through — it never sets those headers on the downstream request. That's why this
  repo's backend verifies the JWT itself instead of trusting headers: right now, the JWT is the
  only identity signal that actually reaches a POC container. `GET /_portal/session-token` (the
  gateway's sliding-refresh endpoint) is real and working, and is what the Auth panel calls first.
- **self-service-portal's launch response doesn't match self-service-api's actual response
  shape.** The portal's `PocLaunchResponse` TypeScript interface expects `expiresAt`, `appUrl`,
  `user`, and `theme`; the real backend (`PocLaunchController`/`PocLaunchService`) returns
  `{ token, expiresIn, launchUrl, pocId, slug }` — no `user`, no `theme`, and different names for
  the other two. As written, `poc-workspace.ts` sets the launch iframe's `src` from the
  now-`undefined` `response.appUrl`, which means launching a POC through the portal's iframe flow
  may not actually load anything today. Worth fixing in `self-service-portal` independently of this
  repo — it isn't something a POC-side change can work around, so this backend and the Auth panel
  are built against the real (`launchUrl`/`expiresIn`) shape and don't depend on the portal fixing
  it to be testable via manual token entry.
- **CORS**: file calls are proxied through the `backend` sidecar rather than called directly from
  the browser specifically so this doesn't depend on self-service-api allowing cross-origin
  requests from arbitrary POC origins. If you change that later, check self-service-api's CORS
  config first.

None of the above blocks testing pieces 1–3 independently (chat, file management via the backend
proxy, and JWT verification all work standalone via docker-compose and a manually-pasted token);
it's specifically end-to-end testing through the portal's iframe launch, and multi-container
deploys through the pipeline, that are gated on the items above landing elsewhere.
