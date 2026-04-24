import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { ResidentProfileContent } from "./ResidentProfilePage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Search, User, ArrowLeft } from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

interface Resident {
  id: number;
  facilityNumber: string;
  firstName: string;
  lastName: string;
  dob: number;
  gender: string;
  roomNumber: string;
  admissionDate: number;
  primaryDx: string;
  levelOfCare: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fundingSource: string;
  status: "active" | "discharged" | "on_leave";
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  discharged: "Discharged",
  on_leave: "On Leave",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  discharged: "secondary",
  on_leave: "outline",
};

function ResidentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "outline"}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

interface AddResidentForm {
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  roomNumber: string;
  admissionDate: string;
  primaryDx: string;
  levelOfCare: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fundingSource: string;
  status: string;
}

const EMPTY_FORM: AddResidentForm = {
  firstName: "",
  lastName: "",
  dob: "",
  gender: "",
  roomNumber: "",
  admissionDate: "",
  primaryDx: "",
  levelOfCare: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  fundingSource: "",
  status: "active",
};

function AddResidentDialog({
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
  const [form, setForm] = useState<AddResidentForm>(EMPTY_FORM);

  const set = (key: keyof AddResidentForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/residents`, {
        ...form,
        dob: form.dob ? new Date(form.dob).getTime() : undefined,
        admissionDate: form.admissionDate ? new Date(form.admissionDate).getTime() : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents`] });
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`] });
      toast({ title: "Resident added" });
      onOpenChange(false);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Resident</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Room Number</Label>
              <Input value={form.roomNumber} onChange={(e) => set("roomNumber", e.target.value)} placeholder="e.g. 101" />
            </div>
            <div className="space-y-1.5">
              <Label>Admission Date</Label>
              <Input type="date" value={form.admissionDate} onChange={(e) => set("admissionDate", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Primary Diagnosis</Label>
            <Input value={form.primaryDx} onChange={(e) => set("primaryDx", e.target.value)} placeholder="Primary diagnosis" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Level of Care</Label>
              <Select value={form.levelOfCare} onValueChange={(v) => set("levelOfCare", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal_care">Personal Care</SelectItem>
                  <SelectItem value="assisted_living">Assisted Living</SelectItem>
                  <SelectItem value="memory_care">Memory Care</SelectItem>
                  <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="discharged">Discharged</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Emergency Contact Name</Label>
              <Input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Name" />
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Contact Phone</Label>
              <Input value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="Phone" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Funding Source</Label>
            <Select value={form.fundingSource} onValueChange={(v) => set("fundingSource", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private_pay">Private Pay</SelectItem>
                <SelectItem value="medi_cal">Medi-Cal</SelectItem>
                <SelectItem value="medicare">Medicare</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Resident"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type StatusFilter = "all" | "active" | "discharged" | "on_leave";

export function ResidentsContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<number | null>(null);

  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: Resident[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const residents = envelope?.data ?? [];

  // If a resident is selected, show their profile
  if (selectedResidentId !== null) {
    return (
      <ResidentProfileContent
        facilityNumber={facilityNumber}
        residentId={selectedResidentId}
        onBack={() => setSelectedResidentId(null)}
      />
    );
  }

  const filtered = residents.filter((r) => {
    const nameMatch =
      search === "" ||
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(search.toLowerCase());
    const statusMatch = statusFilter === "all" || r.status === statusFilter;
    return nameMatch && statusMatch;
  });

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
        <h1 className="text-xl font-semibold">Residents</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Resident
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search residents"
          />
        </div>
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="discharged">Discharged</TabsTrigger>
            <TabsTrigger value="on_leave">On Leave</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load residents.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <User className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {residents.length === 0 ? "No residents yet. Add your first resident." : "No residents match your filters."}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Room</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Admission</th>
                  <th className="text-left px-4 py-3 font-medium">Level of Care</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedResidentId(r.id)}
                  >
                    <td className="px-4 py-3 font-medium">
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">Room {r.roomNumber}</td>
                    <td className="px-4 py-3">
                      <ResidentStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(r.admissionDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">
                      {r.levelOfCare?.replace(/_/g, " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {filtered.map((r) => (
              <button
                key={r.id}
                className="w-full text-left rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                onClick={() => setSelectedResidentId(r.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">
                    {r.firstName} {r.lastName}
                  </span>
                  <ResidentStatusBadge status={r.status} />
                </div>
                <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                  <span>Room {r.roomNumber}</span>
                  <span>Admitted {new Date(r.admissionDate).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <AddResidentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}

export default function ResidentsPage() {
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
      <ResidentsContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
