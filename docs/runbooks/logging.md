# Centralized Logging Runbook — Fly.io → Better Stack

This runbook sets up centralized log shipping from the `ncu` Fly.io app to
Better Stack (formerly Logtail). End-to-end setup takes ~15 minutes.

## Why

Today the only way to read production logs is `fly logs` scrollback, which is
ephemeral (rolls off in roughly an hour of activity), has no search, no
filtering, and no alerting integration. A solo operator cannot reliably find
out what happened after a 2 AM error.

Centralized logging gives us:

- **Persistent retention** — Better Stack's free tier keeps 3 days of logs
  (vs. Fly's effectively-zero window). Paid tiers extend to 30+ days.
- **Structured search** — query by `level`, `requestId`, `path`, `userId`,
  etc., once the sibling Sentry+logging-hygiene work lands structured
  request logs.
- **A destination for Sentry's startup breadcrumbs** — the `[sentry]
  disabled (no DSN)` line and other startup/health/request logs all need
  to land somewhere queryable; this is that place. See
  `docs/runbooks/sentry.md` (sibling runbook) for the error-tracking
  counterpart.

## Recommended tool: Better Stack

| Tool | Free tier | Fly integration | Verdict |
|------|-----------|-----------------|---------|
| **Better Stack** (Logtail) | 1 GB/day, 3-day retention | First-class Fly source type | **Pick this** |
| Axiom | 0.5 GB/day, 30-day retention | Generic HTTP / Vector | Good alternative if you want longer retention on the free tier |
| Datadog | 14-day trial, then paid | Excellent | Only if you have budget — overkill for a solo dev |

We recommend **Better Stack** because the Fly source type is built in (no
Vector config to write), the dashboard is fast, and the free tier comfortably
covers a single-machine Fly app.

If you'd rather use Axiom: the steps below mostly translate — substitute
`AXIOM_TOKEN` and `AXIOM_DATASET` env vars and follow Axiom's Fly guide. The
log-shipper container supports both targets via env vars.

## What you'll need

- A Better Stack account (free, ~2 min to sign up).
- `fly` CLI logged in to the `ncu` app (`fly auth whoami` should print your
  account).
- ~10 minutes of focused time.

---

## Step 1 — Create a Better Stack account

1. Go to <https://betterstack.com/logs>.
2. Click **Sign up** (top right). GitHub OAuth is fastest.
3. After signup you land on the **Telemetry** dashboard. The left nav has
   **Sources**, **Live tail**, **Dashboards**, **Alerts**. We use Sources
   first.

You do not need to create a team — the personal workspace is fine for a
solo developer.

## Step 2 — Create a "Source" of type Fly.io

1. In the left nav, click **Sources** → **Connect source**.
2. **Name**: `ncu-fly-prod` (or whatever — this is only a label).
3. **Platform**: scroll the list and pick **Fly.io**. (If you don't see
   it, search "fly" in the picker — the Fly tile has a balloon icon.)
4. Better Stack shows a panel with two pieces of info:
   - A **source token** (a 32+ char hex/base64 string, see Step 3).
   - An **ingesting host** — usually `in.logs.betterstack.com` or
     `s1234.eu-nbg-2.betterstackdata.com` depending on region. **Copy this
     too** — you'll set it as `LOGTAIL_INGESTING_HOST` only if your region
     differs from the default. Most US workspaces don't need it.
5. Leave region defaults alone unless you have a compliance reason to pin
   EU/US — the default is fine for `ncu` (which runs in `lax`).
6. Click **Create source**.

## Step 3 — Copy the source token

The token looks like:

```
LOGTAIL_SOURCE_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- It is a secret. Treat it like an API key — don't commit it to git, don't
  paste it in a chat log. Store it in your password manager labeled
  "Better Stack — ncu source token".
- Keep the Better Stack tab open; you'll come back in Step 7 to verify
  logs are arriving.

## Step 4 — Provision the secret on Fly

From a terminal where `fly` is authenticated to `ncu`:

```bash
fly secrets set LOGTAIL_SOURCE_TOKEN=<paste-token-here> -a ncu
```

This restages the secret but does **not** restart machines yet — that
happens on the next `fly deploy` in Step 6 (or you can force it with
`fly machine restart` if you don't want a full deploy).

Verify it's stored (you won't see the value, just the name and digest):

```bash
fly secrets list -a ncu
```

You should see a row for `LOGTAIL_SOURCE_TOKEN`.

## Step 5 — Deploy the Fly log shipper as a separate app

> **Confirm current pattern before proceeding.** Fly has changed log
> shipping mechanics several times. As of this runbook, the recommended
> pattern is the **`flyio/log-shipper` Docker image deployed as a
> separate Fly app** that subscribes to your main app's logs over Fly's
> internal NATS bus. The older `[experimental.log_shipper]` directive in
> `fly.toml` is deprecated and should **not** be used in `ncu/fly.toml`.
>
> Before running the steps below, skim
> <https://fly.io/docs/monitoring/sending-logs/> to confirm the
> `superfly/fly-log-shipper` repo (<https://github.com/superfly/fly-log-shipper>)
> is still the published pattern. If Fly has moved to a managed
> "Log Drains" feature in the dashboard, prefer that — it removes the
> need for a separate app entirely.

Assuming the separate-app pattern is current:

1. Clone the log shipper template somewhere outside the `arf-map`
   repo (it is its own Fly app):

   ```bash
   git clone https://github.com/superfly/fly-log-shipper.git
   cd fly-log-shipper
   ```

2. Initialize a new Fly app for the shipper (do **not** reuse `ncu`):

   ```bash
   fly launch --no-deploy --copy-config --name ncu-log-shipper
   ```

   When prompted:
   - Region: `lax` (same as `ncu` — keeps NATS traffic in-region).
   - Postgres/Redis/Upstash: **no** to all.
   - Deploy now: **no** (we set secrets first).

3. Set the shipper's secrets — it needs (a) a Fly access token to read
   the main app's log stream, and (b) the Better Stack token to forward to:

   ```bash
   fly secrets set \
     ACCESS_TOKEN=$(fly auth token) \
     ORG=personal \
     LOGTAIL_SOURCE_TOKEN=<paste-same-token-from-step-3> \
     -a ncu-log-shipper
   ```

   - `ACCESS_TOKEN` — a Fly API token. `fly auth token` prints yours.
     For production you should create a deploy token scoped to the
     org via `fly tokens create org` and use that instead, so the
     shipper isn't tied to your personal account.
   - `ORG` — your Fly org slug. `personal` is correct if you've never
     created a custom org; otherwise run `fly orgs list` to find it.
   - `LOGTAIL_SOURCE_TOKEN` — same value as Step 3 / Step 4.

4. Deploy the shipper:

   ```bash
   fly deploy -a ncu-log-shipper
   ```

   The shipper image is small (~80 MB) and boots in 5–10 seconds. It
   has no public HTTP service — it's a background process that
   subscribes to NATS and pushes to Better Stack over HTTPS.

5. (Optional but recommended) scale the shipper down to a single
   shared-cpu-1x machine — it doesn't need more:

   ```bash
   fly scale vm shared-cpu-1x --memory 256 -a ncu-log-shipper
   fly scale count 1 -a ncu-log-shipper
   ```

**Note on `ncu/fly.toml`**: this runbook does **not** modify the main
app's `fly.toml`. Log shipping is fully external — the only thing
`ncu` needs is the `LOGTAIL_SOURCE_TOKEN` secret (set in Step 4), and
even that is optional if app code doesn't directly call Better Stack
(the shipper does the forwarding). Setting it on `ncu` is harmless and
lets the app optionally log directly to Better Stack later if we move
off the shipper.

## Step 6 — Trigger some traffic on `ncu`

The shipper begins forwarding as soon as it boots in Step 5. To prove
it end-to-end:

```bash
# Hit the health endpoint a few times to generate log lines
curl https://ncu.fly.dev/api/health
curl https://ncu.fly.dev/api/health
curl https://ncu.fly.dev/api/health
```

You can also run `fly deploy -a ncu` if you have other changes queued —
the deploy itself produces many log lines and is a great smoke test.

## Step 7 — Verify in Better Stack

1. Back in the Better Stack tab, click **Live tail** in the left nav.
2. Pick the `ncu-fly-prod` source from the dropdown.
3. Within ~30 seconds of the curl in Step 6 you should see log lines
   arriving — Express request logs, Fly proxy lines (`[info]`,
   `[health]`), and any startup output from `server/index.ts`.
4. Try a search: type `level:error` or `health` in the search bar to
   confirm filtering works.
5. Open the **Sources** page → click `ncu-fly-prod` → the
   "Status" badge should say **Receiving logs** with a recent
   timestamp.

If you see logs flowing: **you're done**. Bookmark the Live tail URL.

---

## Troubleshooting

### No logs in Better Stack after 2+ minutes

1. **Check the shipper is running**:
   ```bash
   fly status -a ncu-log-shipper
   ```
   Expect 1 machine in `started` state. If it's `crashloop` or
   `stopped`, jump to the next check.

2. **Read the shipper's own logs**:
   ```bash
   fly logs -a ncu-log-shipper
   ```
   Common errors:
   - `auth failed` / `401` from NATS — `ACCESS_TOKEN` is wrong or
     expired. Re-run `fly secrets set ACCESS_TOKEN=$(fly auth token)`.
   - `org not found` — `ORG` is wrong; check `fly orgs list`.
   - `403` / `401` from `in.logs.betterstack.com` —
     `LOGTAIL_SOURCE_TOKEN` is wrong or was rotated in the
     Better Stack UI. Copy a fresh one and re-set the secret.

3. **Token typo**: if you pasted from a UI that added a leading/trailing
   space, the secret will silently fail with 401s. Re-set it with
   `fly secrets set` (which trims whitespace).

4. **Region mismatch**: if your Better Stack workspace is in EU but
   the shipper is configured for US (or vice versa), forwarding will
   fail. Check the Source's "Ingesting host" in Better Stack — if it
   is **not** `in.logs.betterstack.com`, set:
   ```bash
   fly secrets set LOGTAIL_INGESTING_HOST=<host-from-source-page> -a ncu-log-shipper
   ```

5. **Shipper out of memory**: at 256 MB the shipper is fine for a
   single-machine app. If you ever scale `ncu` horizontally and the
   shipper OOMs, bump it to `--memory 512`.

### Logs are arriving but they're in the wrong format

The shipper forwards raw Fly log lines. Once the sibling
logging-hygiene work lands structured JSON request logs (single line
per request, keys like `requestId`, `method`, `status`, `durMs`),
Better Stack will auto-parse them and the **Structured** column in
Live tail will populate. Until then you'll see raw text — that is
expected.

### I rotated the Better Stack token, now nothing arrives

You need to update the secret on **both** the main app (Step 4) and the
shipper app (Step 5):

```bash
fly secrets set LOGTAIL_SOURCE_TOKEN=<new> -a ncu
fly secrets set LOGTAIL_SOURCE_TOKEN=<new> -a ncu-log-shipper
```

Setting a secret on the shipper automatically restarts it.

### I want to stop shipping logs temporarily

```bash
fly scale count 0 -a ncu-log-shipper
```

Logs continue to be produced by `ncu`; they just aren't forwarded.
Scale back to 1 to resume.

---

## Cross-reference

- **Sentry** (error tracking) — see `docs/runbooks/sentry.md`. Sentry
  catches uncaught exceptions and surfaces stack traces; Better Stack
  catches *everything else* (request logs, startup, health, ETL, the
  `[sentry] disabled (no DSN)` line during local dev). Both should
  point at the same `ncu` instance and the two views are
  complementary, not redundant.
- **CLAUDE.md env-vars table** has `LOGTAIL_SOURCE_TOKEN` (optional).

## Rollback

If centralized logging causes issues (it shouldn't — it's all
out-of-band):

1. `fly scale count 0 -a ncu-log-shipper` to stop forwarding.
2. `fly secrets unset LOGTAIL_SOURCE_TOKEN -a ncu` if you set it on
   the main app (harmless either way).
3. The main `ncu` app is untouched throughout this runbook — there is
   no rollback needed on it.

To fully remove:

```bash
fly apps destroy ncu-log-shipper
```

And delete the Source in Better Stack's UI.
