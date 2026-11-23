# docker/Dockerfile.ws — Aries Protocol WebSocket Server
# Multi-stage build: compile TypeScript → minimal production image

# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root
RUN addgroup -S aries && adduser -S aries -G aries

WORKDIR /app

# Copy compiled output and production node_modules only
COPY --from=builder --chown=aries:aries /app/dist        ./dist
COPY --from=builder --chown=aries:aries /app/node_modules ./node_modules
COPY --from=builder --chown=aries:aries /app/package.json ./

USER aries

# Health check used by Docker and Kubernetes probes
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

EXPOSE 8080

# Graceful shutdown: SIGTERM is caught by the server
STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
