# Multi-stage Dockerfile for production

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies (including dev for build/test)
COPY package.json package-lock.json* ./
RUN npm install --silent

COPY . .

# Optional: run build step if present
# RUN npm run build

# Production stage
FROM node:18-alpine

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production

USER appuser

EXPOSE 3000

CMD ["node", "src/index.js"]
