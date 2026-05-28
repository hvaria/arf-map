# Environment Variables

## Database

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string (Neon or Fly Postgres). Required for app boot, drizzle-kit, and the test harness. Format: `postgres://user:pass@host:5432/db` |

## Security

| Variable | Required | Purpose |
|----------|----------|---------|
| `SESSION_SECRET` | Yes (prod) | Express session signing key. Generate: `openssl rand -hex 32` |

## Server

| Variable | Required | Purpose |
|----------|----------|---------|
| `NODE_ENV` | No | `development` or `production`. Controls Vite vs static file serving. |
| `PORT` | No | HTTP listen port. Default: `5000`. Fly.io uses `8080`. |

## Email

| Variable | Required | Purpose |
|----------|----------|---------|
| `RESEND_API_KEY` | No | Transactional email for OTP and password reset (Resend.com). |

## ETL / Background Jobs

| Variable | Required | Purpose |
|----------|----------|---------|
| `ETL_HOUR_UTC` | No | Hour (0-23 UTC) for nightly facility enrichment. Default: `2`. |
| `SKIP_PREWARM` | No | Set to any value to skip facility cache pre-warm on startup. |
