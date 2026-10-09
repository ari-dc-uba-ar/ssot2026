FROM node:24.21.0-bookworm-slim

WORKDIR /workspace/system-definition
COPY --from=system-definition package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY --from=system-definition . .
RUN npm run build && npm --prefix consumers/postgres-migrations run build

WORKDIR /workspace/ssot2026
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build
COPY migrations ./migrations
COPY test ./test

CMD ["node", "dist/backend/server.js"]
