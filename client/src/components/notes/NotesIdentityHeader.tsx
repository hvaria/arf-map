/**
 * NotesIdentityHeader — shared "Team notes" identity header for the two
 * Notes surfaces (bell drawer + dedicated /facility-portal/notes page).
 *
 * Slice 2 of the Notes module unifies the visual language across both
 * surfaces. Tokens are extracted verbatim from the original drawer header
 * (NotesNotificationButton lines 97-118):
 *
 *   - background: linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)
 *   - border:     #E0E7FF
 *   - icon:       #818CF8
 *   - heading:    #1E1B4B  ("Team notes")
 *
 * Two variants, sharing the same visual identity:
 *   - "compact"  — bell drawer; no rounding, border-bottom only, no
 *                  facility number suffix.
 *   - "expanded" — dedicated page; rounded-xl, full ring, descriptor
 *                  appends "· Facility #{n}" in muted text-xs.
 *
 * The descriptor flips when there are urgent open notes:
 *   urgentCount > 0 → "{n} urgent · awaiting acknowledgement"
 *   else            → "Shift handoffs, memos, and follow-ups"
 *
 * leftSlot  — page uses for "Back to portal" button
 * rightSlot — drawer uses for "Open full view →" link
 */
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type NotesIdentityHeaderVariant = "compact" | "expanded";

export interface NotesIdentityHeaderProps {
  variant: NotesIdentityHeaderVariant;
  facilityNumber: string;
  /** When > 0, descriptor flips to "{n} urgent · awaiting acknowledgement". */
  urgentCount?: number;
  /** Right-side slot. Drawer uses for "Open full view →". */
  rightSlot?: ReactNode;
  /** Left-side slot, before the icon. Page uses for "Back to portal". */
  leftSlot?: ReactNode;
}

const GRADIENT = "linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)";
const BORDER = "#E0E7FF";
const ICON = "#818CF8";
const HEADING = "#1E1B4B";

export function NotesIdentityHeader({
  variant,
  facilityNumber,
  urgentCount = 0,
  rightSlot,
  leftSlot,
}: NotesIdentityHeaderProps) {
  const descriptor =
    urgentCount > 0
      ? `${urgentCount} urgent · awaiting acknowledgement`
      : "Shift handoffs, memos, and follow-ups";

  const containerStyle =
    variant === "expanded"
      ? {
          background: GRADIENT,
          border: `1px solid ${BORDER}`,
        }
      : {
          background: GRADIENT,
          borderColor: BORDER,
        };

  return (
    <div
      data-testid="notes-identity-header"
      data-variant={variant}
      className={cn(
        "flex items-center gap-2 shrink-0",
        variant === "compact" && "px-5 py-3 border-b",
        variant === "expanded" && "px-4 py-4 rounded-xl border",
      )}
      style={containerStyle}
    >
      {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
      <MessageSquare className="h-5 w-5 shrink-0" style={{ color: ICON }} />
      <div className="min-w-0 flex-1">
        <h2
          className="text-base font-semibold leading-tight"
          style={{ color: HEADING }}
        >
          Team notes
        </h2>
        <p className="text-xs text-muted-foreground leading-tight truncate">
          {descriptor}
          {variant === "expanded" && (
            <span className="ml-1">· Facility #{facilityNumber}</span>
          )}
        </p>
      </div>
      {rightSlot ? <div className="shrink-0 ml-auto">{rightSlot}</div> : null}
    </div>
  );
}
