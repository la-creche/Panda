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

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

RUN apk add --no-cache nginx=1.30.6-r0 \
    && mkdir -p /run/nginx /var/cache/nginx /var/lib/nginx/tmp /var/log/nginx \
    && chown -R 101:101 /run/nginx /var/cache/nginx /var/lib/nginx /var/log/nginx

ARG PANDA_VERSION=""
ARG VCS_REF=""
LABEL org.opencontainers.image.title="Panda" \
      org.opencontainers.image.description="Web client for Agent Client Protocol agents" \
      org.opencontainers.image.source="https://github.com/la-creche/Panda" \
      org.opencontainers.image.version="${PANDA_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="Apache-2.0"

COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8530

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8530/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
