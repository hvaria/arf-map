import { useState } from "react";
import { X, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HH_MM, sortTimes } from "@shared/medication-constants";

interface ScheduledTimeChipsProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestedCount?: number;
  disabled?: boolean;
  ariaLabel?: string;
  error?: string | null;
}

interface TimePopoverProps {
  initial?: string;
  onSave: (time: string) => void;
  trigger: React.ReactNode;
}

function TimePopover({ initial, onSave, trigger }: TimePopoverProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial ?? "08:00");
  const [err, setErr] = useState<string | null>(null);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) { setValue(initial ?? "08:00"); setErr(null); } }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">Scheduled time (24-hour)</label>
          <input
            type="time"
            value={value}
            onChange={(e) => { setValue(e.target.value); setErr(null); }}
            className="border rounded px-2 py-1 text-sm"
            autoFocus
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                if (!HH_MM.test(value)) {
                  setErr("Use 24-hour time, e.g. 08:00 or 21:30.");
                  return;
                }
                onSave(value);
                setOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ScheduledTimeChips({
  value,
  onChange,
  suggestedCount,
  disabled,
  ariaLabel,
  error,
}: ScheduledTimeChipsProps) {
  if (disabled) {
    return (
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground italic">
        Not required for as-needed (PRN) medications.
      </p>
    );
  }

  const removeAt = (idx: number) => {
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
  };

  const replaceAt = (idx: number, newTime: string) => {
    const next = value.map((t, i) => (i === idx ? newTime : t));
    onChange(sortTimes(Array.from(new Set(next))));
  };

  const addTime = (newTime: string) => {
    if (value.includes(newTime)) return;
    onChange(sortTimes([...value, newTime]));
  };

  const showMismatch =
    suggestedCount !== undefined && value.length > 0 && value.length !== suggestedCount;

  return (
    <div className="space-y-1.5" aria-label={ariaLabel}>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No times scheduled.</span>
        )}
        {value.map((t, idx) => (
          <TimePopover
            key={`${t}-${idx}`}
            initial={t}
            onSave={(newTime) => replaceAt(idx, newTime)}
            trigger={
              <Badge variant="secondary" className="cursor-pointer pl-2 pr-0.5 py-0.5 gap-1" tabIndex={0}>
                <Clock className="h-3 w-3" aria-hidden />
                <span className="text-xs">{t}</span>
                <button
                  type="button"
                  className="ml-0.5 rounded hover:bg-muted p-0.5"
                  aria-label={`Remove ${t}`}
                  onClick={(e) => { e.stopPropagation(); removeAt(idx); }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            }
          />
        ))}
        <TimePopover
          onSave={addTime}
          trigger={
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs px-2">
              <Plus className="h-3 w-3 mr-1" />
              Add time
            </Button>
          }
        />
      </div>
      {showMismatch && (
        <p className="text-xs text-muted-foreground">
          Selected {value.length} time{value.length === 1 ? "" : "s"}; this frequency typically uses {suggestedCount}.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
