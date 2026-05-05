import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [open, setOpen] = useState(false);
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
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
        style={{ color: "var(--brand-primary)" }}
      />
      <Input
        ref={inputRef}
        type="search"
        placeholder="Search by name, address, city, zip, or license #..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="pl-9 pr-9 h-10 bg-background/95 backdrop-blur-sm shadow-lg border-border/60 text-sm"
        data-testid="input-search"
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls="search-listbox"
      />
      {isFetching && enabled && (
        <Loader2
          className="absolute right-9 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => {
            onChange("");
            setOpen(false);
            inputRef.current?.focus();
          }}
          data-testid="button-clear-search"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}

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
