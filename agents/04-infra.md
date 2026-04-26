# Agent 4 — Infrastructure: Fly.io Postgres Provisioning

Date: 2026-04-25
Status: COMPLETE

---

## fly.toml Confirmed

| Field | Value |
|-------|-------|
| App name | `ncu` |
| Primary region | `lax` |
| Internal port | `8080` |
| VM memory | `512mb` |
| CPUs | `1` |
| Persistent mount | `/data` (volume: `arf_data`) |

---

## Postgres Cluster Created

Command run:
```bash
fly postgres create --name ncu-db --region lax --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
```

Result:
- Cluster name: `ncu-db`
- Machine ID: `781e121b443268`
- Image: `flyio/postgres-flex:17.2`
- Hostname: `ncu-db.internal`
- Flycast: `fdaa:64:8f53:0:1::2`
- Proxy port: `5432`
- Health checks: 3/3 passing

---

## App Attachment

Command run:
```bash
fly postgres attach ncu-db --app ncu
```

Result:
- Status: SUCCESS
- Database created: `ncu`
- User created: `ncu`
- `DATABASE_URL` secret set on `ncu` app

---

## DATABASE_URL

Format (password redacted):
```
postgres://ncu:***@ncu-db.flycast:5432/ncu?sslmode=disable
```

Status: **Staged** (not yet deployed to running instances — intentional).
Deploy only after Agent 5 implements dual-mode code.

To deploy:
```bash
fly secrets deploy --app ncu
```
Or it will deploy automatically on next `fly deploy`.

---

## Infrastructure Specification

| Parameter | Value |
|-----------|-------|
| Postgres app name | `ncu-db` |
| Region | `lax` |
| Cluster size | 1 node (single) |
| VM size | `shared-cpu-1x` |
| Volume size | 1 GB |
| Postgres version | 17.2 |
| DATABASE_URL set | YES (staged) |
| SSL mode (internal) | `sslmode=disable` (Fly 6PN network encrypts at layer below) |
| SSL mode (external) | Use `sslmode=require` |

---

## Fly Secrets Verification

```
fly secrets list --app ncu
```

| Secret | Status |
|--------|--------|
| NODE_ENV | Deployed |
| SESSION_SECRET | Deployed |
| RESEND_API_KEY | Deployed |
| SMTP_* (5 vars) | Deployed |
| SKIP_PREWARM | Deployed |
| **DATABASE_URL** | **Staged** |

---

## Connection Notes for Agent 5

The pg Pool configuration for internal Fly connections:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // DATABASE_URL already includes ?sslmode=disable for internal Fly connections
  // No need to override ssl option when connecting internally
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

The `?sslmode=disable` in the Fly-provided `DATABASE_URL` is correct for internal Fly private network (6PN) connections. Do not add `ssl: { rejectUnauthorized: false }` — it conflicts with `sslmode=disable`.

---

## Next Steps

1. Agent 5 implements dual-mode code (DATABASE_URL present → Postgres, absent → SQLite)
2. `npm install pg connect-pg-simple @types/pg`
3. `npm run build` must pass with zero TypeScript errors
4. Test locally with DATABASE_URL set
5. When ready to cut over: `fly deploy` (DATABASE_URL staged secret deploys automatically)
