import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RefreshCw, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

interface MedPassEntry {
  id: number;
  residentId: number;
  residentName: string;
  roomNumber: string;
  medicationId: number;
  drugName: string;
  dosage: string;
  route: string;
  scheduledTime: string;
  prescriber: string;
  status: "pending" | "given" | "late" | "missed" | "refused" | "held";
  shift: "AM" | "PM" | "NOC";
  notes?: string;
}

type Shift = "ALL" | "AM" | "PM" | "NOC";

const MED_RIGHTS = [
  "Right Patient",
  "Right Medication",
  "Right Dose",
  "Right Route",
  "Right Time",
  "Right Documentation",
  "Right to Refuse",
  "Right Reason",
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700 border-blue-300",
  given: "bg-green-100 text-green-700 border-green-300",
  late: "bg-orange-100 text-orange-700 border-orange-300",
  missed: "bg-red-100 text-red-700 border-red-300",
  refused: "bg-gray-100 text-gray-700 border-gray-300",
  held: "bg-yellow-100 text-yellow-700 border-yellow-300",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", STATUS_STYLES[status] ?? "bg-muted")}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

interface MedRowProps {
  entry: MedPassEntry;
  facilityNumber: string;
}

function MedRow({ entry, facilityNumber }: MedRowProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState<"detail" | "confirm">("detail");
  const [rights, setRights] = useState<Record<string, boolean>>(
    Object.fromEntries(MED_RIGHTS.map((r) => [r, true]))
  );
  const [notes, setNotes] = useState("");
  const [refuseReason, setRefuseReason] = useState("");
  const [mode, setMode] = useState<"give" | "refuse" | "hold" | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const mutation = useMutation({
    mutationFn: async (data: {
      status: string;
      notes?: string;
      rights?: Record<string, boolean>;
      refuseReason?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/ops/med-passes`,
        {
          medPassEntryId: entry.id,
          residentId: entry.residentId,
          medicationId: entry.medicationId,
          administeredAt: Date.now(),
          ...data,
        }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass`] });
      toast({ title: "Med pass charted" });
      setExpanded(false);
      setStep("detail");
      setMode(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rowBg =
    entry.status === "given"
      ? "bg-green-50 border-green-200"
      : entry.status === "late"
      ? "bg-orange-50 border-orange-200"
      : entry.status === "missed"
      ? "bg-red-50 border-red-200"
      : "";

  return (
    <div className={cn("rounded-lg border transition-colors", rowBg)}>
      {/* Row header — click to expand */}
      <button
        className="w-full text-left p-3 flex items-center gap-3"
        onClick={() => {
          if (entry.status === "pending" || entry.status === "late") {
            setExpanded((v) => !v);
            setStep("detail");
            setMode(null);
          }
        }}
        aria-expanded={expanded}
        aria-label={`${entry.drugName} for ${entry.residentName}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{entry.drugName}</span>
            <span className="text-xs text-muted-foreground">{entry.dosage} {entry.route}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {entry.scheduledTime}
          </div>
        </div>
        <StatusBadge status={entry.status} />
        {(entry.status === "pending" || entry.status === "late") && (
          <span className="text-muted-foreground">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
        )}
      </button>

      {/* Expanded: Step 1 — details + action buttons */}
      {expanded && step === "detail" && (
        <div className="px-3 pb-3 border-t space-y-3">
          <div className="pt-3 text-sm space-y-1">
            <p><span className="text-muted-foreground">Drug:</span> {entry.drugName}</p>
            <p><span className="text-muted-foreground">Dose:</span> {entry.dosage}</p>
            <p><span className="text-muted-foreground">Route:</span> {entry.route}</p>
            {entry.prescriber && (
              <p><span className="text-muted-foreground">Prescriber:</span> {entry.prescriber}</p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => { setMode("give"); setStep("confirm"); }}
            >
              Give
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setMode("refuse"); setStep("confirm"); }}
            >
              Refuse
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setMode("hold"); mutation.mutate({ status: "held", notes: "Held by nurse" }); }}
              disabled={mutation.isPending}
            >
              Hold
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — confirm give */}
      {expanded && step === "confirm" && mode === "give" && (
        <div className="px-3 pb-3 border-t space-y-3 pt-3">
          <p className="text-sm font-medium">Verify 8 Rights</p>
          <div className="space-y-2">
            {MED_RIGHTS.map((right) => (
              <div key={right} className="flex items-center gap-2">
                <Checkbox
                  id={`right-${right}`}
                  checked={rights[right]}
                  onCheckedChange={(v) => setRights((r) => ({ ...r, [right]: !!v }))}
                />
                <label htmlFor={`right-${right}`} className="text-sm cursor-pointer">{right}</label>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes..."
              className="resize-none min-h-[60px]"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => mutation.mutate({ status: "given", notes, rights })}
              disabled={mutation.isPending || !Object.values(rights).every(Boolean)}
            >
              {mutation.isPending ? "Charting..." : "Confirm & Chart"}
            </Button>
            <Button variant="outline" onClick={() => { setStep("detail"); setMode(null); }}>
              Back
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — refuse */}
      {expanded && step === "confirm" && mode === "refuse" && (
        <div className="px-3 pb-3 border-t space-y-3 pt-3">
          <div className="space-y-1.5">
            <Label>Reason for refusal</Label>
            <Textarea
              value={refuseReason}
              onChange={(e) => setRefuseReason(e.target.value)}
              placeholder="Document resident's reason..."
              className="resize-none min-h-[80px]"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => mutation.mutate({ status: "refused", notes: refuseReason })}
              disabled={mutation.isPending || !refuseReason.trim()}
            >
              {mutation.isPending ? "Charting..." : "Chart Refused"}
            </Button>
            <Button variant="outline" onClick={() => { setStep("detail"); setMode(null); }}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EmarContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [shift, setShift] = useState<Shift>("ALL");

  const today = new Date().toISOString().slice(0, 10);

  const { data: envelope, isLoading, error, refetch, isFetching } = useQuery<{ success: boolean; data: MedPassEntry[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass?date=${today}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    refetchInterval: 2 * 60 * 1000, // auto-refresh every 2 minutes
  });

  const medPass = envelope?.data ?? [];

  const filtered = shift === "ALL" ? medPass : medPass.filter((e) => e.shift === shift);

  // Group by resident
  const byResident = filtered.reduce<Record<number, { name: string; room: string; entries: MedPassEntry[] }>>(
    (acc, entry) => {
      if (!acc[entry.residentId]) {
        acc[entry.residentId] = {
          name: entry.residentName,
          room: entry.roomNumber,
          entries: [],
        };
      }
      acc[entry.residentId].entries.push(entry);
      return acc;
    },
    {}
  );

  // Dashboard counts
  const counts = {
    given: medPass.filter((e) => e.status === "given").length,
    pending: medPass.filter((e) => e.status === "pending").length,
    late: medPass.filter((e) => e.status === "late").length,
    missed: medPass.filter((e) => e.status === "missed").length,
  };

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">eMAR</h1>
          <p className="text-sm text-muted-foreground">Med pass for {today}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh med pass"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Dashboard bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Given", count: counts.given, color: "text-green-700 bg-green-50 border-green-200" },
          { label: "Pending", count: counts.pending, color: "text-blue-700 bg-blue-50 border-blue-200" },
          { label: "Late", count: counts.late, color: "text-orange-700 bg-orange-50 border-orange-200" },
          { label: "Missed", count: counts.missed, color: "text-red-700 bg-red-50 border-red-200" },
        ].map(({ label, count, color }) => (
          <div key={label} className={cn("rounded-lg border p-2 text-center", color)}>
            <p className="text-xl font-bold">{count}</p>
            <p className="text-xs font-medium">{label}</p>
          </div>
        ))}
      </div>

      {/* Shift filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Shift:</span>
        {(["ALL", "AM", "PM", "NOC"] as Shift[]).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={shift === s ? "default" : "outline"}
            onClick={() => setShift(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load med pass data.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : Object.keys(byResident).length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">No medications scheduled for this shift.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byResident).map(([residentId, resident]) => (
            <div key={residentId}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">{resident.name}</span>
                <Badge variant="outline">Room {resident.room}</Badge>
              </div>
              <div className="space-y-2">
                {resident.entries.map((entry) => (
                  <MedRow key={entry.id} entry={entry} facilityNumber={facilityNumber} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EmarPage() {
  const [, navigate] = useLocation();

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  const facilityNumber = me?.facilityNumber ?? "";

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (me === null) return null;

  return (
    <PortalLayout>
      <EmarContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
