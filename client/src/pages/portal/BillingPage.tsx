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
import { Plus, Receipt, DollarSign, ArrowLeft } from "lucide-react";

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

interface Charge {
  id: number;
  residentId: number;
  chargeType: string;
  description: string;
  amount: number;
  billingPeriod: string;
  createdAt: number;
}

interface Invoice {
  id: number;
  residentId: number;
  billingPeriod: string;
  totalAmount: number;
  status: "draft" | "sent" | "paid" | "overdue";
  dueDate: number;
  createdAt: number;
}

interface BillingDetail {
  charges: Charge[];
  invoices: Invoice[];
}

const STATUS_STYLES: Record<string, string> = {
  current: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  paid: "bg-gray-100 text-gray-700",
  draft: "bg-yellow-100 text-yellow-700",
  sent: "bg-blue-100 text-blue-700",
};

function AddChargeDialog({
  open,
  onOpenChange,
  residentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  residentId: number;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    chargeType: "",
    description: "",
    amount: "",
    billingPeriod: new Date().toISOString().slice(0, 7),
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/billing/charges`,
        { ...form, residentId, amount: parseFloat(form.amount) }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/residents/${residentId}/billing`] });
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents`] });
      toast({ title: "Charge added" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Charge</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Charge Type</Label>
            <Select value={form.chargeType} onValueChange={(v) => set("chargeType", v)}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="room_and_board">Room & Board</SelectItem>
                <SelectItem value="medication">Medication</SelectItem>
                <SelectItem value="personal_care">Personal Care</SelectItem>
                <SelectItem value="ancillary">Ancillary Service</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="resize-none min-h-[60px]"
              placeholder="Description..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Billing Period</Label>
              <Input type="month" value={form.billingPeriod} onChange={(e) => set("billingPeriod", e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.chargeType || !form.amount}
              className="text-white border-0"
              style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
            >
              {mutation.isPending ? "Adding..." : "Add Charge"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  residentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  residentId: number;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ amount: "", paymentMethod: "", reference: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/billing/payments`,
        { ...form, residentId, amount: parseFloat(form.amount), paidAt: Date.now() }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/residents/${residentId}/billing`] });
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents`] });
      toast({ title: "Payment recorded" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Amount ($)</Label>
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={form.paymentMethod} onValueChange={(v) => set("paymentMethod", v)}>
              <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="ach">ACH</SelectItem>
                <SelectItem value="credit_card">Credit Card</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference / Check #</Label>
            <Input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Reference number" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.amount || !form.paymentMethod}
              className="text-white border-0"
              style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
            >
              {mutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GenerateInvoiceDialog({
  open,
  onOpenChange,
  residentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  residentId: number;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [billingPeriod, setBillingPeriod] = useState(new Date().toISOString().slice(0, 7));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/billing/invoices/generate`,
        { residentId, billingPeriod }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/residents/${residentId}/billing`] });
      toast({ title: "Invoice generated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Billing Period</Label>
            <Input type="month" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="text-white border-0"
              style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
            >
              {mutation.isPending ? "Generating..." : "Generate Invoice"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BillingContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [selectedResidentId, setSelectedResidentId] = useState<number | null>(null);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const { data: residentsEnvelope, isLoading } = useQuery<{ success: boolean; data: Resident[]; meta: { total: number } } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const { data: detailEnvelope } = useQuery<{ success: boolean; data: BillingDetail } | null>({
    queryKey: [`/api/ops/residents/${selectedResidentId}/billing`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && selectedResidentId !== null,
  });

  const residentList = residentsEnvelope?.data ?? [];
  const detail = detailEnvelope?.data ?? null;
  const selectedResident = residentList.find((r) => r.id === selectedResidentId);

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

      <h1 className="text-xl font-semibold" style={{ color: '#1E1B4B' }}>Billing</h1>

      <div className="flex flex-col md:flex-row gap-4">
        {/* Left: resident list */}
        <div className="w-full md:w-72 shrink-0">
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #E0E7FF' }}>
            <div className="px-4 py-2.5 text-xs font-medium" style={{ background: 'linear-gradient(90deg, #EEF2FF, #FFF0F6)', color: '#1E1B4B' }}>
              Resident Accounts
            </div>
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
              </div>
            ) : residentList.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">No residents found.</div>
            ) : (
              <div className="divide-y">
                {residentList.map((r) => (
                  <button
                    key={r.id}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors",
                      selectedResidentId === r.id ? "bg-muted/50" : ""
                    )}
                    onClick={() => setSelectedResidentId(r.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.firstName} {r.lastName}</span>
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", STATUS_STYLES[r.status] ?? "")}>
                        {r.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Room {r.roomNumber}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 space-y-4">
          {!selectedResident ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Receipt className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Select a resident to view billing details.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base font-semibold">{selectedResident.firstName} {selectedResident.lastName}</h2>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setAddChargeOpen(true)}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Charge
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setInvoiceOpen(true)}>
                    <Receipt className="h-4 w-4 mr-1.5" />
                    Generate Invoice
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPaymentOpen(true)}
                    className="text-white border-0"
                    style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
                  >
                    <DollarSign className="h-4 w-4 mr-1.5" />
                    Record Payment
                  </Button>
                </div>
              </div>

              {/* Recent charges */}
              {detail?.charges && detail.charges.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground">
                    Charges
                  </div>
                  <div className="divide-y">
                    {detail.charges.map((c) => (
                      <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{c.description || c.chargeType.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">{c.billingPeriod}</p>
                        </div>
                        <span className="text-sm font-medium">${c.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invoices */}
              {detail?.invoices && detail.invoices.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground">
                    Invoices
                  </div>
                  <div className="divide-y">
                    {detail.invoices.map((inv) => (
                      <div key={inv.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">Invoice — {inv.billingPeriod}</p>
                          <p className="text-xs text-muted-foreground">
                            Due: {new Date(inv.dueDate).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">${inv.totalAmount.toLocaleString()}</span>
                          <span className={cn("text-xs px-1.5 py-0.5 rounded", STATUS_STYLES[inv.status] ?? "")}>
                            {inv.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedResidentId !== null && (
        <>
          <AddChargeDialog
            open={addChargeOpen}
            onOpenChange={setAddChargeOpen}
            residentId={selectedResidentId}
            facilityNumber={facilityNumber}
          />
          <RecordPaymentDialog
            open={paymentOpen}
            onOpenChange={setPaymentOpen}
            residentId={selectedResidentId}
            facilityNumber={facilityNumber}
          />
          <GenerateInvoiceDialog
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            residentId={selectedResidentId}
            facilityNumber={facilityNumber}
          />
        </>
      )}
    </div>
  );
}

export default function BillingPage() {
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
      <BillingContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
