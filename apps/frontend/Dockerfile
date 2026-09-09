# syntax=docker/dockerfile:1
#
# `@yateesha-pappala/poc-bridge` lives in GitHub Packages, so both `npm ci` stages need a
# read:packages token. It is mounted as a BuildKit secret rather than passed as an ARG: an ARG
# is recorded in the image's build history and would ship the credential inside the image.
#
#   DOCKER_BUILDKIT=1 docker build --secret id=npm_token,env=NODE_AUTH_TOKEN -t poc-frontend .
#
# The secret is readable only inside the RUN that mounts it and never becomes a layer.
#
# TEMPORARY — `npm install`, not `npm ci`.
#
# package-lock.json is stale: it records none of poc-bridge, tailwindcss, @tailwindcss/postcss,
# postcss, vitest or jsdom. `npm ci` refuses to run when the lockfile and package.json disagree,
# and that check is local — a valid token does not get past it, because the lockfile it reads is
# the one committed to the repo. Regenerating it needs someone to run `npm install` with a
# read:packages token and commit the result, which has not happened yet.
#
# The cost of this workaround is real: dependencies are no longer pinned, so two builds of the
# same commit can resolve different versions. That is a deliberate deviation from integration
# guide §9 ("reproducible dependency installation"), taken to unblock deployment testing.
#
# REVERT THIS the moment a correct lockfile lands: change both `npm install` lines back to
# `npm ci` / `npm ci --omit=dev`. Nothing else needs to change.

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package*.json .npmrc ./
# The runtime image serves the built bundle with express; the bridge is already compiled into it,
# so this install needs no private scope — but package.json still lists it, so the token is
# mounted here too rather than dropping the dependency from the manifest.
RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY --from=build /app/dist/poc-testbed-frontend/browser ./dist

ENV PORT=8080
CMD ["node", "server.js"]
