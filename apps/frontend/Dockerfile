# syntax=docker/dockerfile:1
#
# `@yateesha-pappala/poc-bridge` lives in GitHub Packages, so both `npm ci` stages need a
# read:packages token. It is mounted as a BuildKit secret rather than passed as an ARG: an ARG
# is recorded in the image's build history and would ship the credential inside the image.
#
#   DOCKER_BUILDKIT=1 docker build --secret id=npm_token,env=NODE_AUTH_TOKEN -t poc-frontend .
#
# The secret is readable only inside the RUN that mounts it and never becomes a layer.

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package*.json .npmrc ./
# The runtime image serves the built bundle with express; the bridge is already compiled into it,
# so this install needs no private scope — but package.json still lists it, so the token is
# mounted here too rather than dropping the dependency from the manifest.
RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN npm ci --omit=dev
COPY server.js ./
COPY --from=build /app/dist/poc-testbed-frontend/browser ./dist

ENV PORT=8080
CMD ["node", "server.js"]
