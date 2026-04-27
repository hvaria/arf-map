# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# better-sqlite3 is a native module — needs build tools to compile
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (including devDeps needed for the build)
COPY package*.json ./
RUN npm ci

# Copy source and build (Vite + esbuild)
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy compiled app bundle
COPY --from=builder /app/dist ./dist

# Copy node_modules intact so native binaries (better-sqlite3) work
COPY --from=builder /app/node_modules ./node_modules

COPY package*.json ./

# /data is mounted as a Fly.io persistent volume for SQLite
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.cjs"]
