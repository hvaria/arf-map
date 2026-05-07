/**
 * NoteGroupTabs — five segmented group tabs for the dedicated Notes page.
 *
 * Reads + writes `?group` via `useNotesUrlState`. The visual style matches
 * the existing GroupChips in `NotesContent.tsx` so the embedded feed and
 * the dedicated page feel coherent.
 */
import {
  Layers,
  Megaphone,
  Stethoscope,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, type GroupKey } from "./shared";

interface Tab {
  key: GroupKey;
  label: string;
  icon: typeof Layers;
}

const TABS: Tab[] = [
  { key: "all", label: GROUP_LABEL.all, icon: Layers },
  { key: "residents", label: GROUP_LABEL.residents, icon: Users },
  { key: "staff", label: GROUP_LABEL.staff, icon: UserCog },
  { key: "memos", label: GROUP_LABEL.memos, icon: Megaphone },
  { key: "providers", label: GROUP_LABEL.providers, icon: Stethoscope },
];

export interface NoteGroupTabsProps {
  value: GroupKey;
  onChange: (g: GroupKey) => void;
}

export function NoteGroupTabs({ value, onChange }: NoteGroupTabsProps) {
  return (
    <nav
      role="tablist"
      aria-label="Note groups"
      className="flex items-center gap-2 flex-wrap"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            data-testid={`notes-tab-${t.key}`}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-muted-foreground border-border hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
