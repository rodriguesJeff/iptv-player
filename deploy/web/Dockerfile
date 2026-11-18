# Web build: serves www/ and proxies Xtream/XUI calls to $IPTV_UPSTREAM.
# Build context = repo root:  docker build -f deploy/web/Dockerfile .
FROM caddy:2.8-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY www /srv
ENV IPTV_UPSTREAM=http://localhost:8787
EXPOSE 80
