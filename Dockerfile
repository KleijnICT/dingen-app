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
ARG DINGEN_VERSION=0.1.0-dev
ENV DINGEN_VERSION=$DINGEN_VERSION
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
ARG DINGEN_VERSION=0.1.0-dev
ENV DINGEN_VERSION=$DINGEN_VERSION
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY apps/server/package.json ./apps/server/
COPY apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
