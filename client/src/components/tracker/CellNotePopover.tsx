/**
 * Per-cell note popover for the QuickEntryGrid. Lets a caregiver attach a
 * free-text note to the most-recent saved tracker entry behind a cell — without
 * leaving Quick Mode and without creating a duplicate entry.
 *
 * The icon button is a separate hit target from the cell body. Clicks on the
 * icon do NOT trigger the cell's tap-to-cycle behavior; the parent stops
 * propagation via the wrapping container's overlay placement (top-right
 * absolute) and we additionally `e.stopPropagation()` on the trigger.
 *
 * Saving issues a PATCH against `/api/ops/trackers/entries/:id` with a merged
 * payload `{ ...existingPayload, note: newNote }`. The backend creates a
 * versioned edit; the entry id is stable across the PATCH, so the cell's
 * tracked `entryId` does NOT need to change on success.
 *
 * Empty/whitespace-only saves with no prior note are no-ops (the popover
 * closes without a network call). Errors keep the popover open with the typed
 * note intact so the user can retry.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, StickyNote, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { usePatchTrackerEntry } from "@/lib/tracker/useTrackerMutation";

const MAX_NOTE_LEN = 500;

export interface CellNotePopoverProps {
  /** Tracker slug (e.g. "adl") — used to scope mutation cache invalidation. */
  slug: string;
  /** id of the most-recent SAVED entry for this cell. */
  entryId: number;
  /** Current saved note ("" or null = no note attached). */
  note: string | null;
  /** The full payload of the most-recent entry — we merge `note` into it. */
  existingPayload: Record<string, unknown>;
  /** Read-only context shown in the popover header. */
  residentName: string;
  goalLabel: string;
  statusLabel: string;
  shift: string;
  /**
   * Called after a successful save with the saved note (trimmed). Lets the
   * parent reflect the new note in its cell-state map without waiting for the
   * entries query refetch.
   */
  onSaved: (savedNote: string) => void;
}

export function CellNotePopover({
  slug,
  entryId,
  note,
  existingPayload,
  residentName,
  goalLabel,
  statusLabel,
  shift,
  onSaved,
}: CellNotePopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(note ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const patchMutation = usePatchTrackerEntry(slug);

  const hasNote = !!(note && note.trim().length > 0);

  // Reset draft whenever the popover is (re)opened, so it always reflects the
  // currently-saved note rather than stale local edits from a prior session.
  useEffect(() => {
    if (open) {
      setDraft(note ?? "");
      setJustSaved(false);
    }
  }, [open, note]);

  // Clean up any pending auto-close timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function handleSave() {
    const trimmed = draft.trim();
    const previousTrimmed = (note ?? "").trim();

    // No-op: empty draft and no prior note → just close.
    if (!trimmed && !previousTrimmed) {
      setOpen(false);
      return;
    }
    // No-op: draft unchanged from saved value → just close.
    if (trimmed === previousTrimmed) {
      setOpen(false);
      return;
    }

    const mergedPayload: Record<string, unknown> = { ...existingPayload };
    if (trimmed) {
      mergedPayload.note = trimmed;
    } else {
      // Clearing the note — remove the key so the payload stays tidy.
      delete mergedPayload.note;
    }

    patchMutation.mutate(
      { id: entryId, patch: { payload: mergedPayload } },
      {
        onSuccess: () => {
          onSaved(trimmed);
          setJustSaved(true);
          // Brief checkmark beat, then auto-close.
          closeTimerRef.current = setTimeout(() => {
            setOpen(false);
            setJustSaved(false);
          }, 900);
        },
        onError: (err) => {
          toast({
            title: "Couldn't save note",
            description: err.message || "Try again.",
            variant: "destructive",
          });
          // Keep the popover open with the user's typed note intact.
        },
      },
    );
  }

  function handleClear() {
    setDraft("");
    // Don't auto-save; user must press Save to commit the clear.
    textareaRef.current?.focus();
  }

  const triggerLabel = hasNote
    ? `Edit note for ${residentName} · ${goalLabel}`
    : `Add note for ${residentName} · ${goalLabel}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={hasNote ? "Edit note" : "Add note"}
          onClick={(e) => {
            // Critical: prevent the cell's tap-to-cycle handler from firing.
            e.stopPropagation();
          }}
          className={cn(
            "absolute top-0.5 right-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md",
            "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
            "hover:bg-black/5",
            hasNote
              ? "text-amber-700"
              : "text-muted-foreground/60 hover:text-muted-foreground",
          )}
        >
          <StickyNote
            className={cn("h-4 w-4", hasNote && "fill-amber-200")}
            aria-hidden="true"
          />
          {hasNote && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-600"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-80"
        onOpenAutoFocus={(e) => {
          // Take focus management ourselves so the textarea (not the close
          // button or trigger) is the autofocus target.
          e.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-foreground">
              {residentName}
            </p>
            <p className="text-xs text-muted-foreground">
              {goalLabel} · {statusLabel} · {shift}
            </p>
          </div>

          <div>
            <label
              htmlFor={`cell-note-${entryId}`}
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Note (optional)
            </label>
            <Textarea
              id={`cell-note-${entryId}`}
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_NOTE_LEN}
              placeholder="e.g. refused due to hip pain"
              rows={4}
              disabled={patchMutation.isPending}
              className="text-sm"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{draft.length}/{MAX_NOTE_LEN}</span>
              {hasNote && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={patchMutation.isPending || !draft}
                  className="font-medium text-rose-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear note
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={patchMutation.isPending}
            >
              <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={patchMutation.isPending || justSaved}
              aria-label="Save note"
            >
              {justSaved ? (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Saved
                </>
              ) : patchMutation.isPending ? (
                <>
                  <Loader2
                    className="mr-1 h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
