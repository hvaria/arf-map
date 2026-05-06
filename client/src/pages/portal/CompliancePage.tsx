import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { toLocalEpochMs } from "@/lib/datetime";
import { FormField, onSubmitKey } from "@/components/portal/FormField";
import { useSession } from "@/hooks/useSession";
import { Plus, ShieldCheck, Check, AlertCircle, Clock, ArrowLeft } from "lucide-react";

interface ComplianceItem {
  id: number;
  facilityNumber: string;
  type: string;
  description: string;
  dueDate: number;
  assignedTo: string;
  status: "pending" | "completed" | "overdue";
  completedAt: number | null;
}

const COMPLIANCE_TYPES = [
  "fire_safety",
  "health_inspection",
  "staff_training",
  "medication_audit",
  "incident_review",
  "resident_rights",
  "documentation_audit",
  "background_checks",
  "license_renewal",
  "other",
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

interface StaffLite {
  id: number;
  firstName: string;
  lastName: string;
  role?: string;
  status?: string;
}

function AddComplianceDialog({
  open,
  onOpenChange,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    type: "",
    description: "",
    dueDate: "",
    assignedTo: "",
  });

  // Staff list drives the assignee dropdown. Free-text used to silently break
  // the dashboard's "My work" queue when the typed name didn't exactly match
  // the assignee's username.
  const { data: staffEnv } = useQuery<{ success: boolean; data: StaffLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    enabled: open && !!facilityNumber,
    staleTime: 60_000,
  });
  const activeStaff = (staffEnv?.data ?? []).filter(
    (s) => !s.status || s.status === "active",
  );

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [showErrors, setShowErrors] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/compliance`, {
        ...form,
        dueDate: form.dueDate ? toLocalEpochMs(form.dueDate) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/compliance`] });
      toast({ title: "Compliance item added" });
      onOpenChange(false);
      setForm({ type: "", description: "", dueDate: "", assignedTo: "" });
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Mirror server-side validation so the user gets feedback before the
  // network call. Server-side enforcement still owns correctness.
  const dueDateMs = form.dueDate ? toLocalEpochMs(form.dueDate) : null;
  const todayMidnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const errors = {
    type: !form.type ? "Pick a compliance type" : undefined,
    dueDate:
      dueDateMs !== null && dueDateMs < todayMidnight
        ? "Due date must be today or later"
        : undefined,
  };
  const isValid = !errors.type && !errors.dueDate;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Compliance Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Type" required error={showErrors ? errors.type : undefined}>
            <Select value={form.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {COMPLIANCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Describe the compliance requirement..."
              className="resize-none min-h-[60px]"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Due Date" error={showErrors ? errors.dueDate : undefined}>
              <Input
                type="date"
                value={form.dueDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </FormField>
            <FormField label="Assigned To">
              <Select
                value={form.assignedTo || "__unassigned__"}
                onValueChange={(v) => set("assignedTo", v === "__unassigned__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select staff…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {activeStaff.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No active staff
                    </div>
                  ) : (
                    activeStaff.map((s) => {
                      const fullName = `${s.firstName} ${s.lastName}`.trim();
                      return (
                        <SelectItem key={s.id} value={fullName}>
                          {fullName}
                          {s.role ? ` · ${s.role.replace(/_/g, " ")}` : ""}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Item"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Group items by month
function groupByMonth(items: ComplianceItem[]): Record<string, ComplianceItem[]> {
  return items.reduce<Record<string, ComplianceItem[]>>((acc, item) => {
    const d = new Date(item.dueDate);
    const key = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

export function ComplianceContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: ComplianceItem[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/compliance`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const items = envelope?.data ?? [];

  const completeMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/compliance/${itemId}`,
        { status: "completed", completedAt: Date.now() }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/compliance`] });
      toast({ title: "Item marked complete" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  const pending = items.filter((i) => i.status === "pending");
  const overdue = items.filter((i) => i.status === "overdue" || (i.status === "pending" && i.dueDate < now));
  const dueThisWeek = items.filter(
    (i) => i.status === "pending" && i.dueDate >= now && i.dueDate <= now + oneWeek
  );

  // Sort: overdue first, then by due date
  const sorted = [...items].sort((a, b) => {
    const aOverdue = a.status === "overdue" || (a.status === "pending" && a.dueDate < now);
    const bOverdue = b.status === "overdue" || (b.status === "pending" && b.dueDate < now);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return a.dueDate - b.dueDate;
  });

  const grouped = groupByMonth(sorted);

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
        <h1 className="text-xl font-semibold" style={{ color: '#1E1B4B' }}>Compliance</h1>
        <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Item
        </Button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: '#F0F4FF', border: '1px solid #E0E7FF' }}>
          <p className="text-xl font-bold">{pending.length}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-xl font-bold text-red-700">{overdue.length}</p>
          <p className="text-xs text-red-600">Overdue</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-center">
          <p className="text-xl font-bold text-yellow-700">{dueThisWeek.length}</p>
          <p className="text-xs text-yellow-600">Due This Week</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load compliance items.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No compliance items. Add your first item.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([month, monthItems]) => (
            <div key={month}>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">{month}</h2>
              <div className="space-y-2">
                {monthItems.map((item) => {
                  const isOverdueItem = item.status === "overdue" || (item.status === "pending" && item.dueDate < now);
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-lg border p-4 flex items-start gap-3",
                        isOverdueItem ? "border-red-200 bg-red-50" : item.status === "completed" ? "opacity-60" : ""
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm capitalize">
                            {item.type?.replace(/_/g, " ")}
                          </span>
                          {isOverdueItem && (
                            <Badge className="bg-red-100 text-red-700 text-xs">
                              <AlertCircle className="h-3 w-3 mr-0.5" />
                              Overdue
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{item.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Due {new Date(item.dueDate).toLocaleDateString()}
                          </span>
                          {item.assignedTo && (
                            <span>Assigned: {item.assignedTo}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("text-xs px-1.5 py-0.5 rounded capitalize", STATUS_STYLES[item.status] ?? "")}>
                          {item.status}
                        </span>
                        {item.status !== "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => completeMutation.mutate(item.id)}
                            disabled={completeMutation.isPending}
                            aria-label="Mark complete"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddComplianceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}

export default function CompliancePage() {
  const [, navigate] = useLocation();

  const { data: me } = useSession();

  const facilityNumber = me?.facilityNumber ?? "";

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (me === null) return null;

  return (
    <PortalLayout>
      <ComplianceContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
