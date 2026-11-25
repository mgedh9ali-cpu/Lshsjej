FROM node:24.22.3-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data && chown node:node /app/data
COPY package.json server.mjs ./
COPY web ./web
COPY lib ./lib
COPY scripts/backup.mjs ./scripts/backup.mjs
COPY scripts/reset-owner-password.mjs ./scripts/reset-owner-password.mjs
USER node
CMD ["node", "server.mjs"]
