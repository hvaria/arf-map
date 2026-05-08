/**
 * Inventory tracker definition + payload schema.
 *
 * Facility-ops, event-style. First tracker to ship with
 * `requiresResident: false` — entries are about a supply transaction (received,
 * consumed, discarded, counted) and do not bind to a resident.
 *
 * The `requiresResident: false` path is already wired:
 *   - `server/trackers/entries/entriesRouter.ts` allows null residentId when
 *     the flag is set
 *   - `client/src/components/tracker/DetailedEntryForm.tsx` hides the resident
 *     field when the flag is set
 *   - `tracker_entries.resident_id` column is nullable
 *   - CSV / PDF exports already render null residents as "—"
 */

import { z } from "zod";

import {
  shiftSchema,
  type HistorySummary,
  type HistoryTone,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary.
// ─────────────────────────────────────────────────────────────────────────────

export const INVENTORY_ACTIONS = [
  "received",
  "consumed",
  "discarded",
  "counted",
] as const;
export type InventoryAction = (typeof INVENTORY_ACTIONS)[number];

const INVENTORY_ACTION_LABEL: Record<InventoryAction, string> = {
  received: "Received",
  consumed: "Consumed",
  discarded: "Discarded",
  counted: "Counted",
};

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema. `quantity` is a non-negative number (allowing decimal counts
// like 0.5 boxes). `unit` and `item_name` are short free-text fields so v1
// can ship without an inventory-catalog system.
// ─────────────────────────────────────────────────────────────────────────────

export const inventoryEntryPayloadSchema = z.object({
  item_name: z.string().min(1).max(120),
  action: z.enum(INVENTORY_ACTIONS),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).max(40),
  shift: shiftSchema,
  note: z.string().max(500).optional(),
});
export type InventoryEntryPayload = z.infer<typeof inventoryEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const INVENTORY_DEFINITION: TrackerDefinition = {
  slug: "inventory",
  name: "Inventory",
  shortName: "Inventory",
  category: "facility-ops",
  schemaVersion: 1,
  icon: "ClipboardList",
  description:
    "Facility-level supply tracking — received, consumed, discarded, or counted per shift.",
  modes: ["detailed", "history"],
  defaultMode: "detailed",
  detailedFields: [
    {
      kind: "text",
      name: "item_name",
      label: "Item",
      required: true,
      placeholder: "e.g. Gloves (medium)",
      maxLength: 120,
    },
    {
      kind: "select",
      name: "action",
      label: "Action",
      required: true,
      options: INVENTORY_ACTIONS.map((v) => ({
        value: v,
        label: INVENTORY_ACTION_LABEL[v],
      })),
    },
    {
      kind: "number",
      name: "quantity",
      label: "Quantity",
      required: true,
      min: 0,
      step: 1,
    },
    {
      kind: "text",
      name: "unit",
      label: "Unit",
      required: true,
      placeholder: "e.g. boxes, bottles, pairs",
      maxLength: 40,
    },
    { kind: "shift", name: "shift", label: "Shift", required: true },
    {
      kind: "textarea",
      name: "note",
      label: "Note",
      required: false,
      maxLength: 500,
    },
  ],
  payloadSchema: inventoryEntryPayloadSchema,
  historySummary: inventoryHistorySummary,
  requiresResident: false,
  supportsBulk: false,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_TONE: Record<InventoryAction, HistoryTone> = {
  received: "info",
  consumed: "info",
  discarded: "elevated", // worth flagging for review
  counted: "normal",
};

export function inventoryHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Inventory (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const itemName =
    typeof p.item_name === "string" ? p.item_name.trim() : "(unspecified item)";
  const action =
    typeof p.action === "string" ? (p.action as InventoryAction) : undefined;
  const qty = typeof p.quantity === "number" ? p.quantity : null;
  const unit = typeof p.unit === "string" ? p.unit.trim() : "";
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  const actionLabel = action ? INVENTORY_ACTION_LABEL[action] ?? action : "—";
  const tone = action ? ACTION_TONE[action] : "info";
  const qtyLabel =
    qty !== null
      ? `${formatQuantity(qty)}${unit ? ` ${unit}` : ""}`
      : "—";

  const primary = note
    ? `${actionLabel} · ${qtyLabel} ${itemName} — “${truncate(note, 80)}”`
    : `${actionLabel} · ${qtyLabel} ${itemName}`;

  return { primary, tone };
}

function formatQuantity(n: number): string {
  // Strip trailing zeros for clean display: 5.00 → 5, 1.50 → 1.5
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
