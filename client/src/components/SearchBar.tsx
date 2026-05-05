import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { normalizeRawType } from "@shared/taxonomy";

interface AutocompleteResult {
  number: string;
  name: string;
  city: string;
  county: string;
  facilityType: string;
}

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Optional element pinned to the right edge of the input — e.g. an
   * embedded filter button. When provided, it's rendered inside the
   * trailing-actions container (no overlap with the input or clear button).
   */
  rightSlot?: ReactNode;
  /**
   * Controlled-mode props for the autocomplete dropdown. When `open` is
   * provided, the parent controls whether the dropdown can show. This
   * lets callers keep the search dropdown and other overlays (e.g. a
   * filters panel) mutually exclusive.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export function SearchBar({ value, onChange, rightSlot, open: openProp, onOpenChange }: SearchBarProps) {
  const isControlled = openProp !== undefined;
  const [openInternal, setOpenInternal] = useState(false);
  const open = isControlled ? !!openProp : openInternal;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (isControlled) onOpenChange?.(resolved);
    else setOpenInternal(resolved);
  };
  const [activeIndex, setActiveIndex] = useState(-1);
  const [debouncedQuery, setDebouncedQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const trimmed = debouncedQuery.trim();
  const enabled = open && trimmed.length >= MIN_QUERY_LENGTH;

  const { data: results = [], isFetching } = useQuery<AutocompleteResult[]>({
    queryKey: ["/api/facilities/search", trimmed],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
    staleTime: 60_000,
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Reset highlight when results change
  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  const showDropdown = open && trimmed.length >= MIN_QUERY_LENGTH;
  const hasResults = results.length > 0;

  const select = (r: AutocompleteResult) => {
    onChange(r.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || !hasResults) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) select(target);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const acronymFor = (type: string): string =>
    normalizeRawType(type)?.acronym ?? "";

  return (
    <div className="relative" data-testid="search-bar" ref={containerRef}>
      {/* Flex shell — carries the visual frame so the input itself can be
          a borderless flex child. Trailing actions live in their own
          container, so typed text and buttons can never overlap. */}
      <div
        className={cn(
          "flex items-center h-10 rounded-md border border-border/60 bg-background/95 backdrop-blur-sm shadow-lg",
          "transition-shadow",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0",
        )}
        // Clicking anywhere on the shell focuses the input — keeps the
        // whole field tappable as a native input would be.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {/* Leading icon */}
        <div className="pl-3 pr-2 shrink-0 pointer-events-none flex items-center">
          <Search
            className="h-4 w-4"
            style={{ color: "var(--brand-primary)" }}
            aria-hidden
          />
        </div>

        {/* Input — flex-1 + min-w-0 so it shrinks instead of pushing
            trailing actions out of the wrapper on small screens. */}
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by name, address, city, zip, or license #..."
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground py-2 px-0"
          data-testid="input-search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="search-listbox"
        />

        {/* Trailing actions container — claims its natural width;
            the input shrinks to fit. */}
        <div className="flex items-center gap-0.5 pl-1 pr-1 shrink-0">
          {isFetching && enabled && (
            <Loader2
              className="h-3.5 w-3.5 mx-1 animate-spin text-muted-foreground shrink-0"
              aria-hidden
            />
          )}
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                inputRef.current?.focus();
              }}
              data-testid="button-clear-search"
              aria-label="Clear search"
              className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {rightSlot}
        </div>
      </div>

      {showDropdown && (
        <div
          id="search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 max-h-80 overflow-y-auto rounded-md border border-border/60 bg-popover shadow-lg"
          data-testid="search-results"
        >
          {!hasResults && !isFetching && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No facilities match "{trimmed}".
            </div>
          )}
          {hasResults && (
            <ul className="py-1">
              {results.map((r, i) => {
                const acronym = acronymFor(r.facilityType);
                const isActive = i === activeIndex;
                return (
                  <li
                    key={r.number}
                    role="option"
                    aria-selected={isActive}
                    className={
                      "px-3 py-2 cursor-pointer text-sm flex items-start justify-between gap-3 " +
                      (isActive ? "bg-accent" : "hover:bg-accent/60")
                    }
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      // mousedown so the input doesn't blur first
                      e.preventDefault();
                      select(r);
                    }}
                    data-testid={`search-result-${r.number}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.city ? `${r.city}` : ""}
                        {r.city && r.county ? " · " : ""}
                        {r.county ? `${r.county} County` : ""}
                        {(r.city || r.county) ? " · " : ""}
                        #{r.number}
                      </div>
                    </div>
                    {acronym && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 mt-0.5"
                        title={r.facilityType}
                      >
                        {acronym}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
