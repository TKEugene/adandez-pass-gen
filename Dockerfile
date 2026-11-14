# Stage 1: stamp this build's id into the page so style.css / app.js get a new URL on every deploy.
# That defeats stale copies held by browsers, CDNs and service workers.
FROM alpine:3 AS site
ARG BUILD_ID=dev
COPY src/ /site/
RUN sed -i "s/__BUILD_ID__/${BUILD_ID}/g" /site/index.html

# Stage 2: the web server. Runs as a non-root user (uid 101) and listens on 8080.
# "stable-alpine" tracks the current nginx stable release; every CI build picks up the latest patches.
FROM nginxinc/nginx-unprivileged:stable-alpine

LABEL org.opencontainers.image.title="adandez-pass-gen" \
      org.opencontainers.image.description="Client-side random password generator" \
      org.opencontainers.image.source="https://github.com/YOUR_GITHUB_USERNAME/adandez-pass-gen"

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=site /site/ /usr/share/nginx/html/random-pass-gen/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
