/**
 * Wave 3 Phase 3.1 (W1) — Daily-triage aggregator.
 *
 * Pure aggregation only — no writes. Composes a `TriagePayload` (single
 * source of truth in `shared/triage.ts`) for one facility by reading the
 * existing storage layer:
 *   - Obligations engine               (overdue obligations)
 *   - Incidents past SLA               (W4)
 *   - Staff credentials                (W3 — expired + expiring)
 *   - Temperature logs                 (out-of-range, unresolved)
 *   - Vendors                          (COI / license expired + expiring)
 *   - Complaints                       (open + investigating)
 *   - Drill logs                       (quarterly fire-drill deficit)
 *   - Chart completeness               (W8)
 *   - Controlled-sub discrepancies     (aging unresolved)
 *
 * Resilience contract: each section runs inside its own try/catch. A
 * downstream storage failure must NOT blank the whole triage — its
 * section returns empty + a console warning, and the rest of the payload
 * is intact. The eleven sections fan out concurrently via `Promise.all`.
 *
 * Tenant isolation: every downstream `list*` call already enforces
 * `facility_number` at the storage layer; we never pass through unscoped
 * data.
 */

import {
  TRIAGE_SECTIONS,
  TRIAGE_SECTION_LABELS,
  compareTriageItems,
  type TriagePayload,
  type TriageItem,
  type TriageSection,
  type TriageSeverity,
} from "@shared/triage";

import { listObligations } from "./obligationsStorage";
import {
  listIncidentsPastSla,
  listExpiringCredentials,
  listVendors,
  listComplaints,
  listTemperatureLogs,
  listControlledSubDiscrepancies,
} from "./opsStorage";
import { listChartCompleteness } from "./chartCompletenessStorage";
import { getRegSetting } from "./regSettings";
import { getPostingRollup, listPostingCatalog } from "./postingsStorage";
import { getDrillCadence } from "./drillCadenceStorage";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PER_SECTION_LIMIT = 10;

function safeNum(s: string | null | undefined, fallback: number): number {
  if (s === null || s === undefined) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function daysBetween(now: number, then: number): number {
  // Positive = "then" was in the past; negative = "then" is in the future.
  return Math.floor((now - then) / DAY_MS);
}

/**
 * Map a generic severity string (high/medium/low/critical) onto the
 * `TriageSeverity` union. Obligation severities are open-ended in the DB
 * (`text`), so we coerce defensively here so the FE sort keys stay stable.
 */
function coerceSeverity(s: string | null | undefined): TriageSeverity {
  if (s === "high" || s === "critical") return "high";
  if (s === "low") return "low";
  return "medium";
}

interface SectionFn {
  (): Promise<TriageItem[]>;
}

/**
 * Wrap a section fetcher with the resilience contract: it returns its
 * items on success and an empty array on failure (with a tagged log so
 * the runtime tells you which section degraded).
 */
async function safeSection(
  section: TriageSection,
  fn: SectionFn,
): Promise<TriageItem[]> {
  try {
    return await fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[triage] section ${section} failed — returning empty:`,
      (err as Error)?.message ?? err,
    );
    return [];
  }
}

export interface AggregateTriageOpts {
  perSectionLimit?: number;
  now?: number;
}

/**
 * Compose a `TriagePayload` for the given facility. The sliced `items`
 * carry at most `perSectionLimit` per section; the `counts` map reflects
 * the un-sliced totals so KPI tiles + email subject totals are accurate.
 */
export async function aggregateTriage(
  facilityNumber: string,
  opts: AggregateTriageOpts = {},
): Promise<TriagePayload> {
  const now = opts.now ?? Date.now();
  const perSectionLimit = Math.max(1, opts.perSectionLimit ?? DEFAULT_PER_SECTION_LIMIT);

  // ── Section fetchers ───────────────────────────────────────────────────
  //
  // Each fetcher returns the un-sliced section payload. Slicing happens at
  // the end so `counts` is always the un-truncated total.

  const overdueObligationsFn: SectionFn = async () => {
    const { rows } = await listObligations(facilityNumber, {
      overdueOnly: true,
      page: 1,
      limit: 50,
    });
    return rows.map<TriageItem>((o) => ({
      section: "overdue_obligations",
      itemKey: `obligation:${o.id}`,
      subject: o.title,
      action: `Resolve ${o.title}`,
      ageDays: daysBetween(now, o.dueAt),
      severity: coerceSeverity(o.severity),
      ownerLabel: o.assignedTo ?? undefined,
      deepLink: { subView: "compliance", entityId: o.id },
    }));
  };

  const incidentsPastSlaFn: SectionFn = async () => {
    const rows = await listIncidentsPastSla(facilityNumber, { limit: 25 });
    return rows.map<TriageItem>((i) => ({
      section: "incidents_past_sla",
      itemKey: `incident:${i.id}`,
      subject: i.incidentType,
      action: `Close out ${i.incidentType}`,
      ageDays: daysBetween(now, i.incidentDate),
      severity: "high",
      ownerLabel: i.reportedBy ?? undefined,
      deepLink: { subView: "incidents", entityId: i.id },
    }));
  };

  // We read the warning-days reg setting once and use the same value for
  // both expired + expiring fetches so the cutoff math is consistent.
  const warningDays = safeNum(
    await getRegSetting(facilityNumber, "CREDENTIAL_WARNING_DAYS").catch(() => null),
    60,
  );

  const credentialsExpiredFn: SectionFn = async () => {
    const rows = await listExpiringCredentials(facilityNumber, {
      withinDays: 0,
      includeExpired: true,
      limit: 50,
    });
    return rows
      .filter((c) => c.expiresAt !== null && c.expiresAt < now)
      .map<TriageItem>((c) => {
        const staffLabel = c.staffName?.trim() || `Staff #${c.staffId}`;
        return {
          section: "credentials_expired",
          itemKey: `credential:${c.id}`,
          subject: `${c.credentialType} — ${staffLabel}`,
          action: `Renew ${c.credentialType} for ${staffLabel}`,
          ageDays:
            c.expiresAt !== null ? daysBetween(now, c.expiresAt) : undefined,
          severity: "high",
          ownerLabel: staffLabel,
          deepLink: { subView: "staff", entityId: c.id },
        };
      });
  };

  const credentialsExpiringFn: SectionFn = async () => {
    const rows = await listExpiringCredentials(facilityNumber, {
      withinDays: warningDays,
      includeExpired: false,
      limit: 50,
    });
    return rows.map<TriageItem>((c) => {
      const staffLabel = c.staffName?.trim() || `Staff #${c.staffId}`;
      // expires_at >= now (per includeExpired:false), so daysUntil is
      // non-negative; ageDays is the negated number (negative = future).
      const daysUntil =
        c.expiresAt !== null
          ? Math.max(0, Math.floor((c.expiresAt - now) / DAY_MS))
          : null;
      return {
        section: "credentials_expiring",
        itemKey: `credential:${c.id}`,
        subject: `${c.credentialType} — ${staffLabel}`,
        action:
          daysUntil !== null
            ? `Renew ${c.credentialType} for ${staffLabel} (${daysUntil}d)`
            : `Renew ${c.credentialType} for ${staffLabel}`,
        ageDays: daysUntil !== null ? -daysUntil : undefined,
        severity: "medium",
        ownerLabel: staffLabel,
        deepLink: { subView: "staff", entityId: c.id },
      };
    });
  };

  const temperatureOorFn: SectionFn = async () => {
    const { logs } = await listTemperatureLogs(facilityNumber, {
      outOfRangeOnly: true,
      page: 1,
      limit: 25,
    });
    return logs
      .filter((l) => l.followUpResolvedAt === null)
      .map<TriageItem>((l) => ({
        section: "temperature_out_of_range_open",
        itemKey: `temperature_log:${l.id}`,
        subject: `${l.fixtureKey} ${l.readingValue}${l.unit}`,
        action: `Resolve ${l.fixtureKey} ${l.readingValue}${l.unit}`,
        ageDays: daysBetween(now, l.readingAt),
        severity: "medium",
        ownerLabel: l.recordedBy ?? undefined,
        deepLink: {
          subView: "audit_readiness/temperature",
          entityId: l.id,
        },
      }));
  };

  // Vendors: one fetch, then partition into expired (already past) and
  // expiring (within 60 days). Volumes per facility are tiny so the
  // in-memory partition is cheap and avoids a second query.
  interface VendorBucket {
    expired: TriageItem[];
    expiring: TriageItem[];
  }
  let vendorBucket: VendorBucket = { expired: [], expiring: [] };
  try {
    const { vendors } = await listVendors(facilityNumber, {
      expiringWithinDays: 60,
      page: 1,
      limit: 50,
    });
    for (const v of vendors) {
      const earliest =
        v.coiExpiresAt !== null && v.licenseExpiresAt !== null
          ? Math.min(v.coiExpiresAt, v.licenseExpiresAt)
          : v.coiExpiresAt ?? v.licenseExpiresAt ?? null;
      const expired = earliest !== null && earliest < now;
      const daysUntil =
        earliest !== null ? Math.floor((earliest - now) / DAY_MS) : null;
      const item: TriageItem = {
        section: expired ? "vendors_expired" : "vendors_expiring",
        itemKey: `vendor:${v.id}`,
        subject: `${v.vendorName} (${v.vendorType})`,
        action: expired
          ? `Renew COI for ${v.vendorName}`
          : `COI for ${v.vendorName} expires in ${Math.max(0, daysUntil ?? 0)}d`,
        ageDays:
          daysUntil !== null
            ? expired
              ? Math.abs(daysUntil)
              : -Math.max(0, daysUntil)
            : undefined,
        severity: expired ? "high" : "medium",
        ownerLabel: v.contactName ?? undefined,
        deepLink: {
          subView: "audit_readiness/vendors",
          entityId: v.id,
        },
      };
      if (expired) vendorBucket.expired.push(item);
      else vendorBucket.expiring.push(item);
    }
  } catch (err) {
    // Match the safeSection contract — both sections drop to empty on
    // failure and the log line surfaces what degraded.
    // eslint-disable-next-line no-console
    console.warn(
      `[triage] section vendors_* failed — returning empty:`,
      (err as Error)?.message ?? err,
    );
    vendorBucket = { expired: [], expiring: [] };
  }

  const vendorsExpiredFn: SectionFn = async () => vendorBucket.expired;
  const vendorsExpiringFn: SectionFn = async () => vendorBucket.expiring;

  const complaintsOpenFn: SectionFn = async () => {
    // Two parallel fetches — open + investigating both belong in this bucket
    // per the spec. listComplaints only filters by single status at a time.
    const [openRes, invRes] = await Promise.all([
      listComplaints(facilityNumber, { status: "open", page: 1, limit: 25 }),
      listComplaints(facilityNumber, {
        status: "investigating",
        page: 1,
        limit: 25,
      }),
    ]);
    return [...openRes.complaints, ...invRes.complaints].map<TriageItem>((c) => ({
      section: "complaints_open",
      itemKey: `complaint:${c.id}`,
      subject: c.nature,
      action: "Investigate / resolve",
      ageDays: daysBetween(now, c.receivedAt),
      severity: "medium",
      ownerLabel: c.assignedTo ?? undefined,
      deepLink: { subView: "audit_readiness/complaints", entityId: c.id },
    }));
  };

  const drillsQuarterDeficitFn: SectionFn = async () => {
    // Wave 4 Phase 4.1 — delegate to the canonical drill cadence calculator
    // so the quarter math + reg setting + soft-delete filter live in one
    // place. Emit ONE TriageItem per deficient shift so the FE can show
    // which shifts need a drill.
    const cadence = await getDrillCadence(facilityNumber, now);
    if (cadence.totalDeficit === 0) return [];
    const items: TriageItem[] = [];
    for (const cell of cadence.fire) {
      if (cell.deficit <= 0) continue;
      items.push({
        section: "drills_quarter_deficit",
        itemKey: `drill_deficit:${cadence.quarterStartAt}:${cell.shift}`,
        subject: `Fire drill — ${cell.shift} shift`,
        action: `Log ${cell.shift} drill (${cell.logged}/${cell.required})`,
        ageDays: daysBetween(now, cadence.quarterStartAt),
        severity: "medium",
        deepLink: { subView: "audit_readiness/drills" },
      });
    }
    return items;
  };

  const postingsStaleOrMissingFn: SectionFn = async () => {
    // Wave 4 Phase 4.1 (W6) — emit one TriageItem per stale/missing
    // posting. Severity: 'high' for missing (no current verification on
    // file), 'medium' for stale (current but past cadence).
    const rows = await listPostingCatalog(facilityNumber, {
      includeArchived: false,
    });
    const items: TriageItem[] = [];
    for (const row of rows) {
      if (row.freshness === "ok") continue;
      const sev: TriageSeverity = row.freshness === "missing" ? "high" : "medium";
      const ageDays = row.latestVerification
        ? daysBetween(now, row.latestVerification.verifiedAt)
        : undefined;
      items.push({
        section: "postings_stale_or_missing",
        itemKey: `posting:${row.id}`,
        subject: `Posting — ${row.titleEn}`,
        action:
          row.freshness === "missing"
            ? `Verify ${row.titleEn}`
            : `Re-verify ${row.titleEn} (last ${ageDays}d ago)`,
        ageDays,
        severity: sev,
        deepLink: { subView: "audit_readiness/postings", entityId: row.id },
      });
    }
    return items;
  };
  // Silence unused-import warning for getPostingRollup (used by routes,
  // not by the aggregator — kept here so the import surface is symmetric).
  void getPostingRollup;

  const chartsIncompleteFn: SectionFn = async () => {
    const res = await listChartCompleteness(
      facilityNumber,
      { worst: "missing", limit: 25 },
      now,
    );
    return res.rows.map<TriageItem>((r) => {
      const residentLabel = `${r.residentFirstName} ${r.residentLastName}`.trim();
      // Count the "missing" items so we can escalate severity above 3.
      const missingCount = r.items?.filter
        ? r.items.filter((i: { status: string }) => i.status === "missing").length
        : 1;
      const severity: TriageSeverity = missingCount >= 3 ? "high" : "medium";
      return {
        section: "charts_incomplete",
        itemKey: `chart:${r.residentId}`,
        subject: residentLabel || `Resident #${r.residentId}`,
        action: `Complete chart for ${residentLabel || `Resident #${r.residentId}`}`,
        severity,
        deepLink: {
          subView: "audit_readiness/charts",
          entityId: r.residentId,
        },
      };
    });
  };

  const controlledSubAgingFn: SectionFn = async () => {
    const { rows } = await listControlledSubDiscrepancies(facilityNumber, {
      resolved: false,
      page: 1,
      limit: 50,
    });
    const sevenDaysMs = 7 * DAY_MS;
    const thirtyDaysMs = 30 * DAY_MS;
    return rows
      .filter((r) => now - r.countDate >= sevenDaysMs)
      .map<TriageItem>((r) => {
        const aged = now - r.countDate;
        const severity: TriageSeverity = aged > thirtyDaysMs ? "high" : "medium";
        const drug = r.drugName ?? `Medication #${r.medicationId}`;
        return {
          section: "controlled_sub_discrepancies_aging",
          itemKey: `controlled_sub:${r.id}`,
          subject: drug,
          action: `Reconcile ${drug}`,
          ageDays: daysBetween(now, r.countDate),
          severity,
          ownerLabel: r.countedBy ?? undefined,
          deepLink: {
            subView: "audit_readiness/controlled_subs",
            entityId: r.id,
          },
        };
      });
  };

  // ── Fan-out: each section in its own try/catch via safeSection ──────────

  const [
    overdueObligations,
    incidentsPastSla,
    credentialsExpired,
    credentialsExpiring,
    temperatureOor,
    vendorsExpired,
    vendorsExpiring,
    complaintsOpen,
    drillsQuarterDeficit,
    chartsIncomplete,
    controlledSubAging,
    postingsStaleOrMissing,
  ] = await Promise.all([
    safeSection("overdue_obligations", overdueObligationsFn),
    safeSection("incidents_past_sla", incidentsPastSlaFn),
    safeSection("credentials_expired", credentialsExpiredFn),
    safeSection("credentials_expiring", credentialsExpiringFn),
    safeSection("temperature_out_of_range_open", temperatureOorFn),
    safeSection("vendors_expired", vendorsExpiredFn),
    safeSection("vendors_expiring", vendorsExpiringFn),
    safeSection("complaints_open", complaintsOpenFn),
    safeSection("drills_quarter_deficit", drillsQuarterDeficitFn),
    safeSection("charts_incomplete", chartsIncompleteFn),
    safeSection("controlled_sub_discrepancies_aging", controlledSubAgingFn),
    safeSection("postings_stale_or_missing", postingsStaleOrMissingFn),
  ]);

  const bySection: Record<TriageSection, TriageItem[]> = {
    overdue_obligations: overdueObligations,
    incidents_past_sla: incidentsPastSla,
    credentials_expired: credentialsExpired,
    credentials_expiring: credentialsExpiring,
    temperature_out_of_range_open: temperatureOor,
    vendors_expired: vendorsExpired,
    vendors_expiring: vendorsExpiring,
    complaints_open: complaintsOpen,
    drills_quarter_deficit: drillsQuarterDeficit,
    charts_incomplete: chartsIncomplete,
    controlled_sub_discrepancies_aging: controlledSubAging,
    postings_stale_or_missing: postingsStaleOrMissing,
  };

  // Counts come from the UN-sliced arrays so KPI tiles are honest about
  // the total backlog even when the response shows a top-N drill-down.
  const counts = TRIAGE_SECTIONS.reduce<Record<TriageSection, number>>(
    (acc, s) => {
      acc[s] = bySection[s].length;
      return acc;
    },
    {
      overdue_obligations: 0,
      incidents_past_sla: 0,
      credentials_expired: 0,
      credentials_expiring: 0,
      temperature_out_of_range_open: 0,
      vendors_expired: 0,
      vendors_expiring: 0,
      complaints_open: 0,
      drills_quarter_deficit: 0,
      charts_incomplete: 0,
      controlled_sub_discrepancies_aging: 0,
      postings_stale_or_missing: 0,
    },
  );

  // Per-section sort + slice for the drill-down list. Per the spec this
  // uses the shared compareTriageItems comparator (severity → ageDays →
  // section), then flattens.
  const flattenedItems: TriageItem[] = [];
  for (const section of TRIAGE_SECTIONS) {
    const arr = [...bySection[section]];
    arr.sort(compareTriageItems);
    for (let i = 0; i < Math.min(perSectionLimit, arr.length); i += 1) {
      flattenedItems.push(arr[i]);
    }
  }
  // Final global sort so the drill-down list is severity-then-age across
  // sections (the email rendering can re-bucket by section using the
  // section key on each item).
  flattenedItems.sort(compareTriageItems);

  return {
    facilityNumber,
    generatedAt: now,
    counts,
    items: flattenedItems,
    totalItems: flattenedItems.length,
  };
}

/**
 * Convenience helper for callers (email renderer) that want the labels
 * keyed by section. Re-exports the shared map so callers don't have to
 * import from two places.
 */
export { TRIAGE_SECTION_LABELS };
