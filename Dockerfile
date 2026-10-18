# syntax=docker/dockerfile:1.7
# --- build stage: compile the Vite bundle -----------------------------------
FROM node:22-alpine AS builder

WORKDIR /build

# npm ci against the committed lockfile: the build is reproducible and fails
# loudly if package.json and package-lock.json ever drift apart.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts postcss.config.js tailwind.config.js eslint.config.js index.html ./
COPY public ./public
COPY src ./src

# Left empty on purpose: in Compose and Kubernetes the frontend talks to
# same-origin /api, which nginx proxies to the backend Service.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# --- runtime stage: unprivileged nginx --------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

# Base-image patching and the metadata write below need root; the image drops
# back to the unprivileged nginx uid (101) before it ever runs.
USER root
RUN apk upgrade --no-cache

# Substitute only BACKEND_* placeholders; nginx's own $uri/$host must survive.
# The rendered server block lands in /tmp because /etc/nginx is read-only.
ENV NGINX_ENVSUBST_FILTER="BACKEND_" \
    NGINX_ENVSUBST_OUTPUT_DIR="/tmp/nginx-conf" \
    BACKEND_UPSTREAM="triplemind-backend:8000"

COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 deploy/nginx/10-prepare-conf-dir.sh /docker-entrypoint.d/10-prepare-conf-dir.sh
COPY --from=builder /build/dist /usr/share/nginx/html

# Static build metadata, so the served bundle can be tied to a commit the same
# way the backend's /version endpoint is.
RUN printf '{"version":"%s","gitSha":"%s","buildTime":"%s"}\n' \
      "${APP_VERSION}" "${GIT_SHA}" "${BUILD_TIME}" > /usr/share/nginx/html/version.json

USER 101

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

LABEL org.opencontainers.image.title="triplemind-frontend" \
      org.opencontainers.image.source="https://github.com/Suswetha6/triplemind" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}"
