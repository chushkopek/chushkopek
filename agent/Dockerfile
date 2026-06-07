# Build/run the L1 agent HTTP service. Lockfile-pinned, no dev deps in the
# runtime image, non-root. Mirrors the slack-alerting deployment.

# --- builder: install all deps and compile TypeScript -> dist ---
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Deps first (cached layer).
COPY package.json package-lock.json ./
RUN npm ci

# Sources (change most often -> last).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime: production deps only + compiled output ---
FROM node:22-bookworm-slim

WORKDIR /app

# Runtime deps only (no dev deps in the image).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production \
    PORT=8000

# Drop privileges.
RUN useradd -r -u 10001 appuser
USER appuser

EXPOSE 8000
CMD ["node", "dist/http/server.js"]
