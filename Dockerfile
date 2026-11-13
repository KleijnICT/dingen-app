# syntax=docker/dockerfile:1
FROM node:26-bookworm-slim AS base
RUN npm install -g pnpm@12
WORKDIR /app

# --- Afhankelijkheden en build ---
FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
ARG DINGEN_VERSION=
ARG DINGEN_COMMIT=
ENV DINGEN_VERSION=$DINGEN_VERSION
ENV DINGEN_COMMIT=$DINGEN_COMMIT
RUN pnpm build

# --- Alleen productie-afhankelijkheden ---
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod

# --- Runtime ---
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ARG DINGEN_VERSION=
ARG DINGEN_COMMIT=
ENV DINGEN_VERSION=$DINGEN_VERSION
ENV DINGEN_COMMIT=$DINGEN_COMMIT
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps /app/packages/mcp/node_modules ./packages/mcp/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY packages/mcp/package.json ./packages/mcp/
COPY --from=build /app/packages/mcp/dist ./packages/mcp/dist
COPY apps/server/package.json ./apps/server/
COPY apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/dingen-entrypoint
RUN mkdir -p /data && chown node:node /data
# No `USER node`: the entrypoint starts as root only to make /data owned by
# node (Home Assistant mounts it as root), then runs the server as node.
VOLUME ["/data"]
# 8080: the app. 8099: Home Assistant ingress, only in Home Assistant mode.
EXPOSE 8080 8099
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dingen-entrypoint"]
CMD ["node", "apps/server/dist/index.js"]
