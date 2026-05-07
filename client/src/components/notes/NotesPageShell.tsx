/**
 * NotesPageShell — sticky page header (title + facility crumb + back to portal)
 * wrapping toolbar + group tabs + responsive split pane.
 *
 * Holds the page-level orchestration:
 *   - Reads URL state via `useNotesUrlState` and is the single source of truth.
 *   - Forwards selection / mutation hooks down to the panes. Stale-selection
 *     clearing is owned by `NotesListPane` itself (gated on settled query
 *     state) so it doesn't race a just-clicked selection.
 */
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotesUrlState } from "@/hooks/useNotesUrlState";
import { NotesToolbar } from "./NotesToolbar";
import { NoteGroupTabs } from "./NoteGroupTabs";
import { NotesListPane } from "./NotesListPane";
import { NoteDetailPane } from "./NoteDetailPane";
import { NotesSplitPane } from "./NotesSplitPane";

export interface NotesPageShellProps {
  facilityNumber: string;
}

export function NotesPageShell({ facilityNumber }: NotesPageShellProps) {
  const url = useNotesUrlState();

  const showDetailOnMobile = url.noteId !== null;

  const list = (
    <NotesListPane
      facilityNumber={facilityNumber}
      group={url.group}
      q={url.q}
      archived={url.archived}
      selectedNoteId={url.noteId}
      onSelect={(id) => url.setNoteId(id)}
      onClearSelection={() => url.setNoteId(null)}
      onClearSearch={() => url.setSearch("")}
    />
  );

  const detail = (
    <NoteDetailPane
      noteId={url.noteId}
      showBack={showDetailOnMobile}
      onBack={() => url.setNoteId(null)}
      onDeleted={() => url.setNoteId(null)}
    />
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Sticky page header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <a href="#/facility-portal" className="shrink-0">
            <Button variant="ghost" size="sm" className="-ml-2">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to portal
            </Button>
          </a>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Notes</h1>
            <p className="text-xs text-muted-foreground leading-tight truncate">
              Operational communication for Facility #{facilityNumber}
            </p>
          </div>
        </div>

        <div className="px-4 pb-3 space-y-2">
          <NotesToolbar
            facilityNumber={facilityNumber}
            group={url.group}
            q={url.q}
            archived={url.archived}
            onSearchChange={url.setSearch}
            onArchivedChange={url.setArchived}
          />
          <NoteGroupTabs value={url.group} onChange={url.setGroup} />
        </div>
      </header>

      {/* Split pane */}
      <NotesSplitPane
        list={list}
        detail={detail}
        showDetailOnMobile={showDetailOnMobile}
      />
    </div>
  );
}
