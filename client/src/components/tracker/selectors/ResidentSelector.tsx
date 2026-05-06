/**
 * Resident single-selector with simple substring search.
 *
 * Reads from `GET /api/ops/residents` (envelope `{ success, data, meta }`).
 * Returns the resident id via `onChange`. We render a native select for the
 * foundation slice — fast to keyboard-navigate, no extra dependency, and
 * "good enough" for a tablet workflow with ~20–60 residents per facility.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ResidentLite {
  id: number;
  firstName: string;
  lastName: string;
  roomNumber?: string | null;
  status?: string;
}

interface ResidentsEnvelope {
  success: boolean;
  data: ResidentLite[];
}

export function useResidents() {
  return useQuery<ResidentsEnvelope | null>({
    queryKey: ["/api/ops/residents"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60_000,
  });
}

export function residentLabel(r: ResidentLite): string {
  const name = `${r.lastName}, ${r.firstName}`.trim();
  return r.roomNumber ? `${name} · Rm ${r.roomNumber}` : name;
}

export function ResidentSelector({
  value,
  onChange,
  placeholder = "Select resident…",
  className,
  required,
  id,
}: {
  value: number | undefined;
  onChange: (id: number | undefined) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  id?: string;
}) {
  const { data, isLoading } = useResidents();
  const [search, setSearch] = useState("");

  const residents = useMemo(() => {
    const all = data?.data ?? [];
    const active = all.filter((r) => r.status !== "discharged");
    if (!search.trim()) return active;
    const q = search.toLowerCase();
    return active.filter((r) =>
      `${r.firstName} ${r.lastName} ${r.roomNumber ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [data, search]);

  return (
    <div className={cn("space-y-2", className)}>
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search residents…"
        aria-label="Search residents"
      />
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : undefined)
        }
        required={required}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        aria-label="Resident"
      >
        <option value="" disabled={required}>
          {isLoading ? "Loading…" : placeholder}
        </option>
        {residents.map((r) => (
          <option key={r.id} value={r.id}>
            {residentLabel(r)}
          </option>
        ))}
      </select>
    </div>
  );
}
