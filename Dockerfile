# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install all deps (including devDeps needed for the build).
# Use `npm install` rather than `npm ci` because esbuild's platform-specific
# binaries (e.g. @esbuild/aix-ppc64) sometimes get written to the lock file
# without the `optional: true` flag depending on which OS generated the lock.
# `npm ci` then errors on EBADPLATFORM in the Linux container.
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy source and build (Vite + esbuild)
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy compiled app bundle
COPY --from=builder /app/dist ./dist

# Copy node_modules so runtime native deps (e.g. pg) work
COPY --from=builder /app/node_modules ./node_modules

COPY package*.json ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.cjs"]
