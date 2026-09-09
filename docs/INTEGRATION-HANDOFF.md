# Integration handoff

What the platform team needs to supply or confirm before this POC can run anywhere real, and what
is already done. Written against the integration guide's contract snapshot of 8 September 2026
(portal bridge protocol v1).

Code state: complete on the POC side. See [ACCEPTANCE.md](./ACCEPTANCE.md) for what has actually
been verified and what has not.

## 1. Blocking prerequisites

### 1.1 A GitHub Packages read token — blocks every build

`@yateesha-pappala/poc-bridge@0.1.0` is published to GitHub Packages, not npmjs.com, so installing
it needs a token with `read:packages` on the `Yateesha-Pappala` org.

This blocks three things today:

- **Local development.** `npm install` in `apps/frontend` fails with `401 Unauthorized` without
  `NODE_AUTH_TOKEN` exported.
- **The committed lockfile.** `apps/frontend/package-lock.json` is stale — it predates the bridge,
  Tailwind and Vitest, because the install that would regenerate it cannot resolve the private
  package. **Someone with a token must run `npm install` and commit the result.** We could not
  produce correct integrity hashes for a registry we cannot reach.
- **The container build.** `apps/frontend/Dockerfile` runs `npm ci`, so the token has to reach the
  build. It is consumed as a BuildKit secret rather than an `ARG`, because an `ARG` is recorded in
  image history and would ship the credential inside the image:

  ```bash
  DOCKER_BUILDKIT=1 docker build --secret id=npm_token,env=NODE_AUTH_TOKEN -t poc-frontend .
  ```

**What we need:** confirmation of how the deploy pipeline supplies a build-time secret to a POC
container build. Guide §9 says secrets provisioning for arbitrary POC containers "is not guaranteed
by the current manifest implementation", and we have deliberately not worked around it by
committing a token or inventing a `secrets:` manifest key.

If the pipeline cannot pass a build secret, the alternatives are for the platform to mirror the
package to a registry the build can already reach, or to vendor the bridge source into each POC —
both of which are platform decisions, not POC ones.

### 1.2 Confirm the JWT issuer

`POC_EXPECTED_ISSUER` is declared as a literal in [`poc.yaml`](../poc.yaml) with the value
`self-service-api`, the platform's current default. It must match the deployment's configured
`jwt.issuer` exactly — a wrong value rejects every token, and the symptom is an indistinguishable
"every API call returns 401".

**What we need:** the confirmed value for each environment this POC will be deployed to.

This is a POC-defined setting, not a platform-injected variable — guide §3 names that gap. If the
pipeline later starts injecting an issuer, we should drop our literal rather than have two sources
disagree.

### 1.3 Confirm the portal origin per environment

`PORTAL_ORIGIN` is platform-injected, and this POC now **refuses to start** without a valid bare
origin: `server.js` exits on a missing, wildcard, path-bearing, or non-loopback-`http` value, and
the bridge's `providePocBridge` throws on the same. That is deliberate (guide §3/§5), and it means
a misconfigured origin is a hard startup failure rather than a POC that will accept a session from
anyone.

**What we need:** the exact origin per environment, with no path and no trailing slash.

### 1.4 A development catalog entry, or a local parent harness

The deployed catalog URL does not point at a local build, so the real portal iframe cannot discover
a locally running POC.

**What we need:** either a development catalog entry pointing at a deployed build of this repo, or
confirmation that we should keep using the bridge's own `startDevHarness()` (which is what the
frontend does today, in development builds only, replaying a real token from
`localStorage['dev.pocToken']`).

## 2. Non-blocking confirmations

| Question | Why it matters |
|---|---|
| Is `/poc-files` enabled for this slug? | `poc.yaml` sets `platform.files.enabled: true`, but guide §9 says that flag provisions nothing. The Files panel is untested against the real endpoints. |
| What are the file size and type limits? | The frontend maps 409/413 to specific messages, but we cannot state the actual limits to users. |
| Does `PLATFORM_API_URL/assets/theme/v1/theme.css` exist? | The previous implementation link-loaded it at runtime. It appears nowhere in the contract, so we removed it and vendored the design layer from `poc-template` instead. If it is real and supported, say so and we will reconsider. |
| Expected POC token lifetime in this environment? | Not hardcoded anywhere — renewal is scheduled from the announced `expiresAt`. Asked only so we can sanity-check renewal timing during a real test. |

## 3. What the platform must inject

Standard, listed for completeness. This POC validates all of them at startup and fails fast.

| Variable | Consumed by | Notes |
|---|---|---|
| `PORT` | both containers | Bound on `0.0.0.0`. Never hardcoded. |
| `POC_SLUG` | both | Backend builds the expected audience `poc:<slug>` from it, never from a token. |
| `PLATFORM_API_URL` | backend | Signing keys from `<url>/.well-known/jwks.json`. Must be https. |
| `PORTAL_ORIGIN` | frontend | Bare origin. Drives message validation, `targetOrigin` and CSP. |
| `SVC_BACKEND_URL` | frontend | Set automatically from the `backend` sidecar name. Never exposed to the browser. |

## 4. What is done on the POC side

- **Bridge**: `@yateesha-pappala/poc-bridge@0.1.0`, not a hand-rolled adapter. The previous
  implementation (a bespoke handshake plus a second, separately-maintained theme listener) is
  deleted.
- **Two gaps closed locally**, both named in guide §6 and both verified still present in 0.1.0:
  the library checks `event.origin` but not `event.source`, and its interceptor attaches the token
  to every outgoing request. `core/parent-source-guard.ts` and `core/poc-api.ts` fix each, with
  tests. **Both should be deleted if a later release absorbs them** — worth raising upstream.
- **Session states**: all five of the bridge's states are rendered, and the business panels exist
  only in `ready`. The manual token-paste field is gone; it was a standalone bypass in production
  code.
- **Backend verification**: RS256 pinned, exact issuer match, exactly one POC audience (an
  ambiguous multi-POC audience is rejected), required `exp`/`sub`/`pocId`, 30s clock skew, and
  trial expiry as a **403** rather than a 401. JWKS keeps Nimbus's bounded cache and rate-limited
  refresh; outage tolerance is off, and an outage answers **503** — never 2xx.
- **Design layer**: vendored from `poc-template` (`src/styles/`), driven from the portal's theme
  rather than `localStorage`. `_branding.css` is the rebrand seam.
- **Tests**: 38 backend, 40 frontend, all passing.

## 5. Things we found that are the platform's call

1. **`poc-bridge@0.1.0` does not check `event.source`.** Origin alone admits any other window at
   the portal's origin — a popup the portal opened, or a sibling iframe. Every POC using this
   package inherits that unless it adds the check itself. Worth fixing in the library.
2. **`pocBridgeInterceptor` is not destination-scoped.** It attaches `Authorization` to every
   outgoing `HttpClient` request. Fine for a POC that only talks to itself; a credential leak for
   one that calls any third party. Also worth fixing upstream.
3. **`poc-template`'s `PORTAL-INTEGRATION.md` is out of date.** It states the portal and an
   embedded app "don't currently sync across the iframe boundary" for theming, and its
   `core/theme.ts` persists to `localStorage` accordingly. The bridge does sync theme now, and a
   stored preference fights it on every reload. A POC that follows the template as written will
   get this wrong.
4. **This repo's own README described the multi-container pipeline as not yet live** and the
   bridge package as unpublished. Both are now false; corrected here.
