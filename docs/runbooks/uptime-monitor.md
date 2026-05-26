# Uptime monitor runbook

**Phase 8 — operational baseline.** Stand up an external uptime monitor
so the first signal of a production outage is a phone notification, not
a user complaint.

The codebase already integrates Better Stack for log shipping (see
[logging.md](./logging.md) — `LOGTAIL_SOURCE_TOKEN` env var). Better Stack
also ships the uptime product, so we get one vendor / one dashboard /
one billing surface. If you have a strong preference for UptimeRobot,
Pingdom, or Checkly the same procedure applies — only the UI labels
differ.

---

## Why a separate monitor (instead of relying on Fly health checks)

Fly's blue-green deploy already checks `/api/health` and refuses to flip
traffic if the green machine is unhealthy. But that only fires during
deploys. Between deploys, the only thing watching is:

- The Fly machine's auto-restart on crash (works for `process.exit(1)`,
  not for "the app is running but every request 500s")
- Sentry (alerts on application errors but won't fire if no traffic is
  hitting the app — including during a full outage where nobody can
  reach it)

An external monitor pings from outside Fly's network and catches:

- DNS / routing failures
- Cert expiry
- A "running but wedged" app (event loop blocked, DB pool exhausted)
- Region-wide Fly outages

---

## Endpoints to monitor

| URL                              | Frequency | Alert on |
|----------------------------------|-----------|----------|
| `https://ncu.fly.dev/api/health`      | 30 s   | 2 consecutive failures |
| `https://ncu.fly.dev/api/health/deep` | 60 s   | 2 consecutive failures OR response > 3 s |

**Why both:**

- `/api/health` is the liveness probe — it tells you the Node process
  is alive and serving HTTP. Cheap to call.
- `/api/health/deep` is the readiness probe — it does a `SELECT 1`
  against Postgres with a 2 s timeout, returns 503 if the DB is
  unreachable. Catches the "app up, DB down" case that liveness misses.

Don't poll `/api/health/deep` faster than once a minute. Each call
takes a connection from the pool; at 5 s intervals from a single
monitor you'd burn ~12 connections/min on monitoring alone, which is
non-trivial against a small Postgres plan.

---

## Better Stack setup (one-time)

1. Sign in at <https://betterstack.com/uptime>. Same workspace as the
   logging product if you already have it.
2. **Monitors → Create monitor.**
   - URL: `https://ncu.fly.dev/api/health`
   - Check frequency: 30 seconds
   - Request timeout: 5 seconds
   - Regions: pick at least 2 (one US East, one US West) so a single
     monitor region going down doesn't false-page you.
   - Expected status code: 200
   - **Recovery period:** 1 check (i.e. recover as soon as one check
     passes — outages are usually transient enough that 1 confirmation
     is correct; using 2+ delays the all-clear).
   - **Confirmation period:** 2 checks (avoid paging on a single
     transient blip).
3. Repeat for `https://ncu.fly.dev/api/health/deep`.
   - Frequency: 60 s
   - Add a body-content check: `"status":"ok"` substring. This catches
     a regression that flips the JSON shape but still returns 200.
4. **Heartbeats → Create heartbeat** (optional, for the ETL):
   - Name: `nightly-etl-enrichment`
   - Expected period: 24 h
   - Grace: 1 h
   - Have `server/etlScheduler.ts` POST to the heartbeat URL on
     successful completion. Defer wiring this up unless the ETL has
     ever silently failed.
5. **Notifications → Escalation policy.**
   - Tier 1: email + SMS to your number.
   - Tier 2 (if no ack in 5 min): a second number / email.
   - Quiet hours: optional, but for a B2B SaaS the on-call window
     is "business hours of your customer base," not 24/7.

---

## What "alerted" should mean

A page should mean *user-visible impact RIGHT NOW*. Things that should
NOT page:

- A single failed check (flap suppression handles this — see "2
  consecutive failures" above).
- A degraded but functional state (`/api/health/deep` returns 200 with
  `checks.db=slow` would be a future enhancement; today it's binary).
- Sentry errors with `level=warning`.

Things that SHOULD page:

- `/api/health` returns non-200 for ≥ 60 s.
- `/api/health/deep` returns 503 for ≥ 2 minutes (DB issue tolerance is
  slightly higher because Neon autosuspends after idle and the first
  request after a wake takes ~1 s).
- Response time on `/api/health` > 5 s for ≥ 3 minutes (process is
  alive but wedged).

---

## When the page fires — first 5 minutes

The runbook on the phone should be **short**:

1. Hit `https://ncu.fly.dev/api/health` from your browser. If it loads,
   move on; the alert may have already recovered.
2. Hit `https://ncu.fly.dev/api/health/deep`. If status=ok but the
   alert was firing, the issue was the DB — check the Neon / Fly
   Postgres dashboard.
3. `flyctl logs -a ncu --since 10m` to see what crashed.
4. `flyctl status -a ncu` — is the machine healthy?
5. If the app is dead and won't come back: `flyctl machine restart -a ncu`.
6. If the app is fine but the DB is dead: see [backup-restore.md](./backup-restore.md).
7. If both look healthy and the alert is still firing, the monitor
   itself may be flaky — check Better Stack's status page before
   declaring an incident.

After resolution:

- Acknowledge the alert in Better Stack.
- File a one-paragraph post-mortem in Notion / your tracker. Even a
  trivial blip is worth recording — patterns only emerge across
  multiple incidents.

---

## What's NOT covered

- **Synthetic transaction monitoring.** A real "log in, click around,
  save a note" flow would catch issues that bare HTTP checks miss
  (e.g. CSRF token rotation breaking POSTs). Defer until the app has
  enough traffic that 2 minutes of broken POSTs would be noticed by a
  user before the monitor catches it.
- **Per-tenant SLA monitoring.** "Is facility X's data reachable" is
  not the same as "is the app up." Out of scope until the customer
  base is big enough to need per-tenant SLOs.
- **Internal performance budgets.** Better Stack will record response
  times; if a per-route latency budget (p95 < 500ms for `GET /api/jobs`)
  becomes important, prefer instrumenting in Sentry Performance or a
  dedicated APM rather than ad-hoc Better Stack alerts.
