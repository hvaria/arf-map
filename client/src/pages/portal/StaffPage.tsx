import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { toLocalEpochMs, todayLocal } from "@/lib/datetime";
import { FormField, onSubmitKey } from "@/components/portal/FormField";
import { useSession } from "@/hooks/useSession";
import { Plus, Users, AlertCircle, ArrowLeft } from "lucide-react";

interface StaffMember {
  id: number;
  facilityNumber: string;
  firstName: string;
  lastName: string;
  role: string;
  status: "active" | "inactive" | "on_leave";
  hireDate: number;
  licenseExpiry: number | null;
  email: string;
  phone: string;
}

interface Shift {
  id: number;
  staffId: number;
  staffName: string;
  shiftType: "AM" | "PM" | "NOC";
  shiftDate: number;
  startTime: string;
  endTime: string;
}

const ROLES = [
  "administrator",
  "caregiver",
  "med_tech",
  "rn",
  "lpn",
  "activity_coordinator",
  "dietary",
  "housekeeping",
  "maintenance",
  "other",
];

const SHIFT_TYPES = ["AM", "PM", "NOC"] as const;

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function AddStaffDialog({
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
    firstName: "",
    lastName: "",
    role: "",
    email: "",
    phone: "",
    hireDate: "",
    licenseExpiry: "",
    status: "active",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [showErrors, setShowErrors] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/staff`, {
        ...form,
        hireDate: form.hireDate ? toLocalEpochMs(form.hireDate) : Date.now(),
        licenseExpiry: form.licenseExpiry ? toLocalEpochMs(form.licenseExpiry) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/staff`] });
      toast({ title: "Staff member added" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Inline validation: required fields + future-only license expiry.
  const expiryMs = form.licenseExpiry ? toLocalEpochMs(form.licenseExpiry) : null;
  const errors = {
    firstName: !form.firstName.trim() ? "First name is required" : undefined,
    lastName:  !form.lastName.trim() ? "Last name is required" : undefined,
    role:      !form.role ? "Pick a role" : undefined,
    licenseExpiry:
      expiryMs !== null && expiryMs <= Date.now() ? "Must be a future date" : undefined,
  };
  const isValid =
    !errors.firstName && !errors.lastName && !errors.role && !errors.licenseExpiry;
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
          <DialogTitle>Add Staff Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First Name" required error={showErrors ? errors.firstName : undefined}>
              <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name" />
            </FormField>
            <FormField label="Last Name" required error={showErrors ? errors.lastName : undefined}>
              <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Last name" />
            </FormField>
          </div>
          <FormField label="Role" required error={showErrors ? errors.role : undefined}>
            <Select value={form.role} onValueChange={(v) => set("role", v)}>
              <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com" />
            </FormField>
            <FormField label="Phone">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Hire Date">
              <Input type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
            </FormField>
            <FormField
              label="License Expiry"
              error={showErrors ? errors.licenseExpiry : undefined}
              hint="Must be in the future"
            >
              <Input type="date" value={form.licenseExpiry} onChange={(e) => set("licenseExpiry", e.target.value)} />
            </FormField>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Staff"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddShiftDialog({
  open,
  onOpenChange,
  facilityNumber,
  staff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  staff: StaffMember[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    staffId: "",
    shiftType: "AM" as typeof SHIFT_TYPES[number],
    shiftDate: todayLocal(),
    startTime: "06:00",
    endTime: "14:00",
  }));

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const [showErrors, setShowErrors] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/shifts`, {
        ...form,
        staffId: Number(form.staffId),
        shiftDate: toLocalEpochMs(form.shiftDate),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/schedule`] });
      toast({ title: "Shift added" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Inline validation: pick a person, sane time order.
  const errors = {
    staffId: !form.staffId ? "Pick a staff member" : undefined,
    times: form.startTime >= form.endTime ? "End time must be after start" : undefined,
  };
  const isValid = !errors.staffId && !errors.times;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Staff Member" required error={showErrors ? errors.staffId : undefined}>
            <Select value={form.staffId} onValueChange={(v) => set("staffId", v)}>
              <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.firstName} {s.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Shift Type">
              <Select value={form.shiftType} onValueChange={(v) => set("shiftType", v as typeof SHIFT_TYPES[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Date">
              <Input type="date" value={form.shiftDate} onChange={(e) => set("shiftDate", e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Time" error={showErrors ? errors.times : undefined}>
              <Input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </FormField>
            <FormField label="End Time">
              <Input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
            </FormField>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Shift"}
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

function WeeklySchedule({ shifts, facilityNumber }: { shifts: Shift[]; facilityNumber: string }) {
  // Build a week starting from Sunday
  const today = new Date();
  const dayOfWeek = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dayOfWeek);
  sunday.setHours(0, 0, 0, 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });

  const getShiftsForDayAndType = (day: Date, shiftType: typeof SHIFT_TYPES[number]) => {
    return shifts.filter((s) => {
      const sd = new Date(s.shiftDate);
      sd.setHours(0, 0, 0, 0);
      return sd.getTime() === day.getTime() && s.shiftType === shiftType;
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-[600px]">
        <thead>
          <tr>
            <th className="border px-2 py-2 text-left bg-muted/50 w-16">Shift</th>
            {weekDays.map((d, i) => (
              <th key={i} className={cn("border px-2 py-2 text-center bg-muted/50", d.toDateString() === today.toDateString() ? "bg-primary/10" : "")}>
                <div>{DAYS_OF_WEEK[d.getDay()]}</div>
                <div className="text-muted-foreground font-normal">{d.getDate()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SHIFT_TYPES.map((shiftType) => (
            <tr key={shiftType}>
              <td className="border px-2 py-2 font-medium bg-muted/20">{shiftType}</td>
              {weekDays.map((d, i) => {
                const dayShifts = getShiftsForDayAndType(d, shiftType);
                return (
                  <td key={i} className="border px-1 py-1 align-top min-h-[40px]">
                    {dayShifts.map((s) => (
                      <div key={s.id} className="text-xs bg-primary/10 rounded px-1 py-0.5 mb-0.5 truncate">
                        {s.staffName}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StaffContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [addShiftOpen, setAddShiftOpen] = useState(false);

  const { data: staffEnvelope, isLoading: loadingStaff, error: staffError } = useQuery<{ success: boolean; data: StaffMember[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const { data: shiftsEnvelope, isLoading: loadingShifts } = useQuery<{ success: boolean; data: Shift[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/schedule`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const staff = staffEnvelope?.data ?? [];
  const shifts = shiftsEnvelope?.data ?? [];

  const now = Date.now();

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

      <h1 className="text-xl font-semibold" style={{ color: '#1E1B4B' }}>Staff</h1>

      <div className="portal-tabs">
      <Tabs defaultValue="directory">
        <TabsList className="w-full">
          <TabsTrigger value="directory" className="flex-1">Directory</TabsTrigger>
          <TabsTrigger value="schedule" className="flex-1">Schedule</TabsTrigger>
        </TabsList>

        {/* Directory Tab */}
        <TabsContent value="directory" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setAddStaffOpen(true)}
              className="text-white border-0"
              style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Staff
            </Button>
          </div>

          {staffError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
              Failed to load staff.
            </div>
          )}

          {loadingStaff ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : staff.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No staff members yet.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-left px-4 py-3 font-medium">Role</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium">Hire Date</th>
                      <th className="text-left px-4 py-3 font-medium">License Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {staff.map((s) => {
                      const licExpired = s.licenseExpiry && s.licenseExpiry < now;
                      return (
                        <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-medium">{s.firstName} {s.lastName}</td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className="capitalize text-xs">
                              {s.role?.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={s.status === "active" ? "default" : "outline"}
                              className="text-xs capitalize"
                            >
                              {s.status?.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {s.hireDate ? new Date(s.hireDate).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {s.licenseExpiry ? (
                              <span className={cn("flex items-center gap-1 text-sm", licExpired ? "text-red-600" : "text-muted-foreground")}>
                                {licExpired && <AlertCircle className="h-3.5 w-3.5" />}
                                {new Date(s.licenseExpiry).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {staff.map((s) => {
                  const licExpired = s.licenseExpiry && s.licenseExpiry < now;
                  return (
                    <div key={s.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{s.firstName} {s.lastName}</span>
                        <Badge variant={s.status === "active" ? "default" : "outline"} className="text-xs capitalize">
                          {s.status?.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                        <span className="capitalize">{s.role?.replace(/_/g, " ")}</span>
                        {s.licenseExpiry && (
                          <span className={cn(licExpired ? "text-red-600" : "")}>
                            {licExpired && "EXPIRED: "}Lic expires {new Date(s.licenseExpiry).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <AddStaffDialog open={addStaffOpen} onOpenChange={setAddStaffOpen} facilityNumber={facilityNumber} />
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setAddShiftOpen(true)}
              className="text-white border-0"
              style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Shift
            </Button>
          </div>

          {loadingShifts ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <WeeklySchedule shifts={shifts} facilityNumber={facilityNumber} />
          )}

          <AddShiftDialog
            open={addShiftOpen}
            onOpenChange={setAddShiftOpen}
            facilityNumber={facilityNumber}
            staff={staff}
          />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const [, navigate] = useLocation();

  const { data: me } = useSession();

  const facilityNumber = me?.facilityNumber ?? "";

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (me === null) return null;

  return (
    <PortalLayout>
      <StaffContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
