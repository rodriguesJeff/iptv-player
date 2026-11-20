# Sync service for favorites / series progress. Build context = repo root:
#   docker build -f deploy/sync/Dockerfile -t iptv-sync .
# Configuration comes only from the environment (set it in Dokploy, never in this file).
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# Same layout as the repo: lib/merge.js loads ../../../www/js/merge.js
COPY www/js/merge.js /app/www/js/merge.js
COPY deploy/sync/server.js /app/deploy/sync/server.js
COPY deploy/sync/lib /app/deploy/sync/lib
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8790/sync/health >/dev/null || exit 1
CMD ["node", "/app/deploy/sync/server.js"]
