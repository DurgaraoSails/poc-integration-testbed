# Acceptance checklist

Against §13 of the POC integration guide (contract snapshot 8 September 2026, portal bridge
protocol v1). Assessed 8 September 2026.

**Nothing here has been exercised against a real deployed environment.** Every PASS is an
automated test or a locally observed result, reproducible with the commands below. Everything
requiring the real portal, the real platform API, or a built container image is marked NOT RUN
with its prerequisite. A passing mocked handshake is not a successful deployed integration.

## How to reproduce

```bash
cd apps/backend && ./mvnw test
```

```bash
cd apps/frontend && npm test
```

Totals at time of writing: **38 backend tests, 40 frontend tests, all passing.**

The frontend commands need `NODE_AUTH_TOKEN` (a GitHub PAT with `read:packages`) to install
`@yateesha-pappala/poc-bridge`. See [INTEGRATION-HANDOFF.md](./INTEGRATION-HANDOFF.md).

---

## Authentication and isolation

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Missing token cannot read data, mutate state, upload/download, start a job, or invoke a paid/model API | **PASS** | `JwtVerificationTest`: `chatRequiresAuthentication`, `filesRequireAuthentication`. `/healthz` is the only unauthenticated route. |
| 2 | Valid intended-POC token authenticates as verified `sub` | **PASS** | `JwtVerificationTest.validToken` |
| 3 | Invalid signature, wrong key, unknown unresolved `kid`, unsigned token, disallowed algorithm rejected | **PASS** | `tamperedSignature`, `swappedPayload`, `unknownKid`, `unsignedToken` (`alg: none`), `disallowedAlgorithm` (HS256) |
| 4 | Wrong issuer, missing/wrong audience, another POC's token, a portal access token rejected | **PASS** | `wrongIssuer`, `missingAudience`, `otherPocAudience`, `ambiguousAudience`, `portalAccessToken` |
| 5 | Expired token, malformed required claims, future `nbf` rejected | **PASS** | `expired`, `missingExpiry`, `notYetValid`, `blankSubject`, `missingPocId`, `malformedPocId` |
| 6 | Expired trial denies protected work even if `exp` is later; absent claim follows documented behaviour | **PASS** | `trialExpired` (403, not 401), `trialActive`, `trialAbsent`, `trialMalformed` (fails closed) |
| 7 | User A cannot read/update/delete/export or inspect jobs/files belonging to user B by changing an ID | **PARTIAL** | This POC owns no records; file isolation is enforced by the platform from the token. The POC's half is tested — `FilesProxyIsolationTest` proves each caller's own token is forwarded, no user/POC parameter is ever sent, a caller-supplied file ID is passed through unmodified for the platform to authorize, and a 404 is relayed rather than masked. **The cross-user denial itself is NOT RUN** — needs the real platform with two real users. |
| 8 | JWKS cache/unknown-key refresh bounded; verification outages fail closed; rollover succeeds with a newly published key | **PASS** | `JwksResilienceTest`: `rollover` (a key rotated in after startup is picked up without redeploy), `outageFailsClosed` (503, never 2xx), `recovers`. Cache bounds, rate limiting and refresh-ahead are Nimbus defaults, left in place deliberately; outage tolerance is off. |
| 9 | Public health, static shell, and safe runtime config work without a bearer token and reveal no private data | **PASS** | `healthIsOpen`. Shell verified locally — see *Packaging* row 5 for the captured headers; the injected config carries only `basePath`, `portalOrigin`, `slug`, `version`. |

## Browser and session lifecycle

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Embedded startup receives a v1 session and only then loads protected data | **PARTIAL** | `app.spec.ts` proves the gate: business panels exist in the DOM only when `status() === 'ready'`, and the files request fires only then. The v1 exchange itself is `@yateesha-pappala/poc-bridge`'s, tested in its own repo. **End-to-end NOT RUN** — needs the portal. |
| 2 | Wrong origin/source, malformed payloads, unsupported versions ignored without crashes or credential logs | **PARTIAL** | `parent-source-guard.spec.ts` covers the source check this POC adds (5 cases, incl. that other origins are left alone and nothing is logged in production). Origin, shape and version checks are the library's. |
| 3 | Direct production opening shows the portal-launch message; missing session times out visibly | **PASS** | `app.spec.ts`: `not-embedded` renders "Open this POC from the self-service portal" with no input element (asserting the removed token-paste bypass has not returned); `timed-out` renders a recoverable message with a retry, not a spinner. |
| 4 | Proactive renewal replaces the token without reloading the iframe or losing UI state | **NOT RUN** | Library behaviour (75% of announced lifetime, 5s floor). Needs a portal or the dev harness with a real token. |
| 5 | Concurrent 401s create one renewal; a request retries at most once; 403 does not cause a refresh loop | **PARTIAL** | `poc-api.interceptor.spec.ts`: one renewal per 401 then exactly one retry with the new token; a second 401 propagates; 403 and 500 trigger no renewal. **Concurrency coalescing across simultaneous requests is the library's `refresh()` and is NOT directly tested here.** |
| 6 | Renewal timeout and expired-session behaviour stop unauthorized work and present recovery UI | **NOT RUN** | Needs a portal that stops answering. |
| 7 | Session-ended clears sensitive state, stops timers/streams, ignores late sessions/responses | **PARTIAL** | `app.spec.ts` proves the strong part: a rendered file listing is gone from the DOM after the session ends. Timer cancellation and ignoring delayed sessions are the library's. No streams or polling in this POC. |
| 8 | Initial and live light/dark themes work | **PASS** | `poc-theme.spec.ts`: initial session theme applied, live `portal:theme` change applied without reload, and nothing persisted to `localStorage`. |
| 9 | Token never enters persistent browser storage, cookies, URLs, logs, or third-party requests | **PARTIAL** | `poc-api.interceptor.spec.ts` proves the token is not attached to another host or to public assets on our own origin. Downloads use a Blob URL, not a tokenised URL. The token itself is held in a private field by the library. **No automated assertion that storage stays empty.** |
| 10 | Optional files: upload/list/download/delete work with the POC token; quota/type/size failures understandable | **PARTIAL** | `files-panel.spec.ts` covers the message mapping (400/401/403/404/409/413/0 all distinct and actionable); `FilesProxyIsolationTest` proves the backend relays 404/409/413 with their own status codes. **The real `/poc-files` calls are NOT RUN** — needs the platform. |
| 11 | Any streaming or non-replayable requests have explicitly tested authentication/retry behaviour | **NOT APPLICABLE**, with a note | No EventSource, WebSocket or streaming in this POC. The one mutation that can be retried is the multipart upload: the interceptor may replay it after a 401, which is safe here because the 401 comes from this POC's own backend *before* anything is forwarded to the platform, and Angular holds the body as a `FormData` object rather than a consumed stream. Worth re-checking if uploads ever become streamed. |

## Packaging and real integration

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Every declared Dockerfile builds using its manifest context; startup uses runtime `PORT` and binds correctly | **NOT RUN** | Image builds were not attempted. Static consistency verified: both declared `dockerfile`/`context` pairs exist, and every `COPY` source resolves inside its declared context (`package*.json`, `.npmrc`, `server.js`, the Angular output path `dist/poc-testbed-frontend/browser`; `pom.xml`, `src`, the built jar). Both processes read `PORT` and bind `0.0.0.0`. **Prerequisites: a running Docker daemon, and `NODE_AUTH_TOKEN` for the frontend image.** |
| 2 | Exactly one ingress; sidecar ports distinct; proxy preserves auth/body/status and uses runtime service URLs | **PARTIAL** | Manifest verified by inspection: one `role: ingress` (frontend, 8080), one sidecar (backend, 8081), no collision, no reserved names in `env`. The proxy forwards `Authorization` and relays status/body unbuffered of interpretation and reads `SVC_BACKEND_URL` at runtime. **Proxy behaviour NOT RUN against a live sidecar.** |
| 3 | Declared health endpoints work; SPA routes and assets load through the ingress | **PARTIAL** | `GET /healthz` on the running ingress returned `200 ok`; `GET /` returned the shell (SPA fallback). Backend `/healthz` covered by `JwtVerificationTest.healthIsOpen`. **Not verified through a deployed ingress→sidecar pair.** |
| 4 | Runtime origin/API configuration can change without rebuilding the frontend | **PASS** | The same built bundle was served twice with different `PORTAL_ORIGIN`/`POC_SLUG` env values and emitted different injected config and a different CSP, with no rebuild. |
| 5 | CSP permits the intended portal and prevents an unrelated origin framing the POC; no conflicting `X-Frame-Options` | **PASS** | Observed on the running server with `PORTAL_ORIGIN=https://portal.example.com`: `Content-Security-Policy: frame-ancestors https://portal.example.com`, `Cache-Control: no-store`, and no `X-Frame-Options` header. Startup validation refuses `*`, a path-bearing origin, and non-loopback `http`. |
| 6 | No real secrets in manifest, browser assets, runtime JSON, Docker layers, or committed examples | **PARTIAL** | `poc.yaml` `env` holds one non-secret literal. Injected runtime JSON contains only `basePath`, `portalOrigin`, `slug`, `version`. `.npmrc` names an env var, never a token; `.env.example` ships an empty `NODE_AUTH_TOKEN`. The Dockerfiles take the token as a BuildKit secret rather than an `ARG`, so it cannot land in a layer — **but that has not been verified against a built image.** |
| 7 | Actual portal launch, backend data call, token renewal, theme toggle, and logout/trial termination exercised in the target environment | **NOT RUN** | The headline gap. Prerequisites in [INTEGRATION-HANDOFF.md](./INTEGRATION-HANDOFF.md): a registry token, a confirmed issuer and portal origin, a catalog entry pointing at a deployed build, and `/poc-files` enabled for the slug. |

---

## Summary

| | Authentication & isolation | Browser & session | Packaging & integration |
|---|---|---|---|
| PASS | 8 | 3 | 2 |
| PARTIAL | 1 | 6 | 3 |
| NOT RUN | 0 | 2 | 2 |
| N/A | 0 | 1 (noted) | 0 |

The verification chain is thoroughly covered and the session gate is proven at the component
level. What remains unproven is everything that needs a counterparty: the real portal handshake,
real renewal timing, real platform file calls, and real container builds.

## One defect found and fixed while writing these

Every authenticated endpoint was broken before the tests existed. `SessionController.whoami` and
all four `FilesProxyController` methods declared a bare `Jwt` parameter, which Spring cannot
resolve — it treats it as a model attribute and throws `BeanInstantiationException`. The 401 paths
worked, which is exactly why it went unnoticed. Fixed by adding `@AuthenticationPrincipal`.
