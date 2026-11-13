# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

WORKDIR /app

# Match CI's pnpm major. Corepack is included in the pinned Node 24 image.
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# Keep dependency installation cacheable when application sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY desktop/package.json desktop/package.json
COPY test-agent/package.json test-agent/package.json
COPY scripts/sync-material-icons.mjs scripts/sync-material-icons.mjs
RUN pnpm install --frozen-lockfile

COPY . .

# Release CI supplies the planned tag version. Ad-hoc/Arcane builds fall back
# to package.json through vite.config.ts when this argument is left empty.
ARG PANDA_VERSION=""
ENV PANDA_VERSION=${PANDA_VERSION}
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

ARG PANDA_VERSION=""
ARG VCS_REF=""
LABEL org.opencontainers.image.title="Panda" \
      org.opencontainers.image.description="Web client for Agent Client Protocol agents" \
      org.opencontainers.image.source="https://github.com/la-creche/Panda" \
      org.opencontainers.image.version="${PANDA_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="Apache-2.0"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
