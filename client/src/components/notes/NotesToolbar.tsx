/**
 * NotesToolbar — search + archived toggle + "New note" button.
 *
 * Search input is debounced 250ms internally before pushing the value up to
 * `?q=`. The X clears both local input and URL. "New note" opens a Dialog
 * containing the existing extracted Composer (per Slice 1 product decision).
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Composer } from "./composer/Composer";
import { useResidents } from "@/hooks/useResidents";
import {
  GROUP_REQUIRES_RESIDENT,
  type ArchivedFlag,
  type GroupKey,
} from "./shared";

export interface NotesToolbarProps {
  facilityNumber: string;
  group: GroupKey;
  q: string;
  archived: ArchivedFlag;
  onSearchChange: (q: string) => void;
  onArchivedChange: (a: ArchivedFlag) => void;
}

export function NotesToolbar({
  facilityNumber,
  group,
  q,
  archived,
  onSearchChange,
  onArchivedChange,
}: NotesToolbarProps) {
  const [input, setInput] = useState(q);
  const [composerOpen, setComposerOpen] = useState(false);

  // Keep local input in sync when URL `q` changes via something other than
  // typing here (e.g., back/forward navigation, direct URL edit).
  const lastPushedRef = useRef(q);
  useEffect(() => {
    if (q !== lastPushedRef.current) {
      setInput(q);
      lastPushedRef.current = q;
    }
  }, [q]);

  // Debounce input → URL.
  useEffect(() => {
    if (input === q) return;
    const t = setTimeout(() => {
      lastPushedRef.current = input.trim();
      onSearchChange(input.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [input, q, onSearchChange]);

  // Resident list for the modal Composer (only loaded when the active group
  // needs it OR when the modal is open and the user might switch group inside
  // the composer's own group selector). Lifted from NotesContent.tsx.
  const needsResidents =
    composerOpen || GROUP_REQUIRES_RESIDENT[group] || group === "all";
  const { residents } = useResidents(facilityNumber, {
    activeOnly: false,
    enabled: needsResidents,
  });

  const handleClear = () => {
    setInput("");
    lastPushedRef.current = "";
    onSearchChange("");
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search notes…"
          className="h-9 pl-8 pr-8 text-sm"
          aria-label="Search notes"
          data-testid="notes-search"
        />
        {input && (
          <button
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Archived toggle */}
      <button
        type="button"
        onClick={() => onArchivedChange(archived === 1 ? 0 : 1)}
        className={cn(
          "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors h-9",
          archived === 1
            ? "bg-foreground text-background border-foreground"
            : "bg-card text-muted-foreground border-border hover:text-foreground",
        )}
        aria-pressed={archived === 1}
        data-testid="notes-archived-toggle"
      >
        {archived === 1 ? "Showing archived" : "Show archived"}
      </button>

      <div className="ml-auto">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setComposerOpen(true)}
          data-testid="notes-new-button"
        >
          <Plus className="h-4 w-4" />
          New note
        </Button>
      </div>

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="max-w-xl" data-testid="notes-composer-dialog">
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
          </DialogHeader>
          <Composer
            activeGroup={group}
            residents={residents}
            onPosted={() => setComposerOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
