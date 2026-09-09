# backend (sidecar)

Spring Boot 4.1, Java 21. Deployed as the `backend` sidecar in [`poc.yaml`](../../poc.yaml),
reachable from the `frontend` ingress container at `SVC_BACKEND_URL` (`http://localhost:8081` once
deployed; `http://backend:8081` in the local `docker-compose.yml`, since Compose gives containers
their service name as a hostname instead).

```bash
./mvnw spring-boot:run
./mvnw test
```

## Configuration

Every value is required, and validated at startup — the service refuses to come up rather than
running against a half-configured platform.

| Variable | Source | Notes |
|---|---|---|
| `PORT` | platform | Bound on `0.0.0.0`. Never hardcode it. |
| `POC_SLUG` | platform | Builds the expected audience `poc:<slug>`. Never read from a token. |
| `PLATFORM_API_URL` | platform | Signing keys come from `<url>/.well-known/jwks.json`. Must be https. |
| `POC_EXPECTED_ISSUER` | **this POC** | Declared as a literal in `poc.yaml`. See below. |
| `POC_ALLOW_INSECURE_PLATFORM_URL` | this POC | Permits an http platform URL, loopback only. Local dev. |

`POC_EXPECTED_ISSUER` is not a platform-injected variable, and was previously misnamed `JWT_ISSUER`
as though it were. The pipeline injects the slug, the API URL and the portal origin, but no issuer
— integration guide §3 names that gap and asks each POC to define its own setting. It must match
the platform's configured `jwt.issuer`; `self-service-api` is the current default, and should be
confirmed with the platform contact before deploying to a new environment. A wrong value here
rejects every token.

## What it actually does

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | container health check |
| `POST /api/chat` | **Bearer POC JWT** | canned, static chatbot replies — see `ChatService` |
| `GET /api/session/whoami` | Bearer JWT | reports the verified identity |
| `POST /api/files` | Bearer JWT | proxies to the platform's `POST /poc-files` (multipart) |
| `GET /api/files` | Bearer JWT | proxies to `GET /poc-files` |
| `GET /api/files/{id}/content` | Bearer JWT | proxies to `GET /poc-files/{id}/content` |
| `DELETE /api/files/{id}` | Bearer JWT | proxies to `DELETE /poc-files/{id}` |

`/healthz` is the only unauthenticated route. Chat used to be open on the grounds that its replies
are static, but it is still a route that executes work on request — guide §1/§4.1 puts those behind
a verified token regardless of what the work costs today.

## JWT verification (the point of this service)

`SecurityConfig` builds a Spring `NimbusJwtDecoder` pointed at
`${PLATFORM_API_URL}/.well-known/jwks.json`, the JWKS endpoint the platform exposes for the launch
tokens it mints in `POST /pocs/{slug}/launch`. Keys are only ever fetched from that configured URL
— never from a `jku`, `x5u` or issuer URL named by the token itself.

Checked on every request:

- **RS256 only**, pinned explicitly rather than left to a library default, so `none` and any
  symmetric algorithm are rejected on the header.
- **Signature** against the JWKS key selected by `kid`.
- **`iss`** equals `POC_EXPECTED_ISSUER`, by exact string match. Deliberately not Spring's
  `JwtIssuerValidator`, which parses the claim as a URL — the platform's issuer is the plain string
  `self-service-api`.
- **`aud`** is *exactly* `poc:${POC_SLUG}`, from this container's own config. A token carrying a
  different POC's audience is rejected, and so is one carrying this POC's audience alongside
  another's: an ambiguous audience is not a valid POC token (guide §4.5).
- **Required claims**: a present `exp`, a nonempty `sub`, and a positive whole-number `pocId`. An
  absent `exp` is rejected rather than treated as non-expiring, which is what `JwtTimestampValidator`
  alone would do.
- **`exp`/`nbf`** with 30 seconds of clock skew.

Any of those failing is a `401` from the resource-server filter, before a controller runs.

**Trial expiry is separate, and returns `403`.** `TrialAuthorizationManager` runs as an
authorization decision rather than a token validator, because the token is valid and its holder is
authenticated — what has run out is their entitlement. An absent `trialEndDate` means no
restriction; a malformed one fails closed.

The JWKS cache is Nimbus's own default: bounded lifetime, rate-limited refresh on an unknown `kid`,
refresh-ahead. Outage tolerance stays **off** — if the keys cannot be resolved, the request is
denied. An unverified token is never accepted because the platform was unreachable. What the
defaults do not supply is a network timeout, so `jwksRestOperations` adds one.

### Tests

`JwtVerificationTest` drives the real filter chain, the real decoder and real RSA signatures
through 22 cases — valid token, unknown `kid`, HS256, wrong issuer, wrong/missing/ambiguous
audience, expired, missing `exp`, future `nbf`, blank `sub`, malformed `pocId`, and each trial
case. Only the HTTP transport that fetches the key set is substituted, with an in-memory fixture;
everything downstream of the bytes is the real thing. Fixture keys never leave the test, and the
application has no "accept a test token" path.

## Why file calls are proxied here rather than called directly from the browser

The frontend could call the platform's `/poc-files` endpoints directly with the same bearer token.
Routing them through this sidecar avoids depending on the platform allowing cross-origin requests
from every POC's own deployed origin, and doubles as a demonstration that this backend can use the
token to call a platform endpoint on the user's behalf.

The platform derives both the user and the POC from the token, which is why these routes take no
user or POC parameter — and why one must never be added. Only `Content-Type` and
`Content-Disposition` are relayed back from upstream; framing and hop-by-hop headers are dropped
rather than describing a response this container has already re-encoded.
