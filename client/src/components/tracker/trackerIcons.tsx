/**
 * Lucide icon resolver for tracker definitions.
 *
 * The `TrackerDefinition.icon` field is a string (e.g. "ListChecks") so it
 * can travel over the wire. We resolve it here against a small whitelist —
 * importing every Lucide icon dynamically would defeat tree-shaking.
 *
 * Add entries as new trackers ship.
 */
import {
  ClipboardList,
  ListChecks,
  Activity,
  HeartPulse,
  Pill,
  Utensils,
  Bath,
  Bed,
  AlertTriangle,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  ListChecks,
  Activity,
  HeartPulse,
  Pill,
  Utensils,
  Bath,
  Bed,
  AlertTriangle,
  Stethoscope,
};

export function resolveTrackerIcon(name: string | undefined): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return ClipboardList;
}
