FROM node:24-bookworm-slim
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY package.json server.mjs ./
COPY web ./web
COPY scripts/backup.mjs ./scripts/backup.mjs
USER node
CMD ["node", "server.mjs"]
