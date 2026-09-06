# backend (sidecar)

Spring Boot 4.1, Java 21. Deployed as the `backend` sidecar in [`poc.yaml`](../../poc.yaml),
reachable from the `frontend` ingress container at `SVC_BACKEND_URL` (`http://localhost:8081` once
deployed; `http://backend:8081` in the local `docker-compose.yml`, since Compose gives containers
their service name as a hostname instead).

```bash
./mvnw spring-boot:run
```

## What it actually does

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | container health check |
| `POST /api/chat` | none | canned, static chatbot replies — see `ChatService` |
| `GET /api/session/whoami` | **Bearer POC-scoped JWT** | proves the token verifies; echoes back its claims |
| `POST /api/files` | Bearer JWT | proxies to self-service-api `POST /poc-files` (multipart upload) |
| `GET /api/files` | Bearer JWT | proxies to self-service-api `GET /poc-files` |
| `GET /api/files/{id}/content` | Bearer JWT | proxies to self-service-api `GET /poc-files/{id}/content` |
| `DELETE /api/files/{id}` | Bearer JWT | proxies to self-service-api `DELETE /poc-files/{id}` |

## JWT verification (the point of this service)

`SecurityConfig` builds a standard Spring `NimbusJwtDecoder` pointed at
`${PLATFORM_API_URL}/.well-known/jwks.json` — the same JWKS endpoint self-service-api itself
exposes for RS256 verification of the launch tokens it mints in `POST /pocs/{slug}/launch`. On top
of signature verification it checks:

- `iss` equals `JWT_ISSUER` (default `self-service-api`)
- `aud` contains `poc:${POC_SLUG}` — **not** whatever slug the token itself claims; the expected
  slug always comes from this container's own config, so a token minted for a different POC is
  rejected
- `exp`/`nbf` with ±60s clock skew

If all of that passes, `GET /api/session/whoami` returns the verified claims. If any check fails,
Spring Security's resource-server filter rejects the request with `401` before the controller ever
runs — that rejection, not a 200 with fabricated data, is what "testing authentication" is
actually exercising.

## Why file calls are proxied here rather than called directly from the browser

The frontend could call self-service-api's `/poc-files` endpoints directly from browser JS using
the same bearer token. Routing them through this sidecar instead avoids relying on self-service-api
allowing cross-origin requests from every POC's own deployed origin, and doubles as a second,
independent demonstration that this backend can use the token to call a platform endpoint on the
user's behalf — which is the pattern `poc-platform-sdk`'s own contract recommends for SPA+API POCs.
