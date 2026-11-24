FROM node:24-bookworm-slim
WORKDIR /app
RUN mkdir data && chown node:node data
COPY server.mjs classroom.mjs ./
COPY migrations ./migrations
ENV QUM_BIND=0.0.0.0
USER node
CMD ["node", "server.mjs"]
