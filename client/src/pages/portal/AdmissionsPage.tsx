import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";

interface Lead {
  id: number;
  prospectName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  careNeeds: string;
  stage: string;
}

interface LicForm {
  formId: string;
  label: string;
  required: boolean;
  completed: boolean;
  completedAt: number | null;
}

interface AdmissionsData {
  lead: Lead;
  forms: LicForm[];
}

const LIC_FORMS = [
  { formId: "lic601", label: "LIC 601 — Application for Licensure", required: true },
  { formId: "lic602a", label: "LIC 602A — Facility Personnel Record", required: true },
  { formId: "lic603", label: "LIC 603 — Facility Liability", required: true },
  { formId: "lic604a", label: "LIC 604A — Admission Agreement", required: true },
  { formId: "lic605a", label: "LIC 605A — Personal Rights", required: true },
  { formId: "lic610d", label: "LIC 610D — Resident Appraisal", required: true },
  { formId: "admission_agreement", label: "Admission Agreement", required: true },
  { formId: "physician_report", label: "Physician Report", required: false },
  { formId: "tb_test", label: "TB Test Results", required: false },
];

export function AdmissionsContent({
  facilityNumber,
  leadId,
  onBack,
}: {
  facilityNumber: string;
  leadId: string;
  onBack?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: envelope, isLoading } = useQuery<{ success: boolean; data: AdmissionsData } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/leads/${leadId}/admissions`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!leadId,
  });

  const admissions = envelope?.data ?? undefined;

  // Local state for form completions (optimistic)
  const [localForms, setLocalForms] = useState<Record<string, { completed: boolean; completedAt: string }>>({});

  const updateFormMutation = useMutation({
    mutationFn: async ({ formId, completed, completedAt }: { formId: string; completed: boolean; completedAt: string }) => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/leads/${leadId}/lic/${formId}`,
        { completed, completedAt: completedAt ? new Date(completedAt).getTime() : null }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/leads/${leadId}/admissions`] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/leads/${leadId}/convert`,
        {}
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Resident created from admission" });
      if (onBack) onBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const forms = admissions?.forms ?? LIC_FORMS.map((f) => ({
    formId: f.formId,
    label: f.label,
    required: f.required,
    completed: false,
    completedAt: null,
  }));

  const completedCount = forms.filter((f) => {
    const local = localForms[f.formId];
    return local !== undefined ? local.completed : f.completed;
  }).length;

  const requiredForms = forms.filter((f) => f.required);
  const allRequiredComplete = requiredForms.every((f) => {
    const local = localForms[f.formId];
    return local !== undefined ? local.completed : f.completed;
  });

  const progressPct = forms.length > 0 ? Math.round((completedCount / forms.length) * 100) : 0;

  const handleToggle = (formId: string, checked: boolean) => {
    const now = new Date().toISOString().slice(0, 16);
    setLocalForms((prev) => ({
      ...prev,
      [formId]: { completed: checked, completedAt: checked ? now : "" },
    }));
    updateFormMutation.mutate({
      formId,
      completed: checked,
      completedAt: checked ? now : "",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <div>
        <h1 className="text-xl font-semibold">Admissions</h1>
        {admissions?.lead && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {admissions.lead.prospectName}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span>{completedCount}/{forms.length} forms complete</span>
          <span className="text-muted-foreground">{progressPct}%</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      {/* Resident info summary */}
      {admissions?.lead && (
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <h2 className="font-medium">Prospect Information</h2>
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <div><span className="text-foreground">Contact:</span> {admissions.lead.contactName}</div>
            <div><span className="text-foreground">Phone:</span> {admissions.lead.contactPhone}</div>
            <div><span className="text-foreground">Email:</span> {admissions.lead.contactEmail}</div>
            <div><span className="text-foreground">Stage:</span> {admissions.lead.stage.replace(/_/g, " ")}</div>
          </div>
          {admissions.lead.careNeeds && (
            <div className="text-muted-foreground">
              <span className="text-foreground">Care needs:</span> {admissions.lead.careNeeds}
            </div>
          )}
        </div>
      )}

      {/* LIC forms checklist */}
      <div>
        <h2 className="text-sm font-medium mb-3">LIC Forms Checklist</h2>
        <div className="space-y-2">
          {LIC_FORMS.map((licForm) => {
            const formData = forms.find((f) => f.formId === licForm.formId);
            const local = localForms[licForm.formId];
            const isCompleted = local !== undefined ? local.completed : (formData?.completed ?? false);
            const completedAt = local?.completedAt || (formData?.completedAt ? new Date(formData.completedAt).toLocaleDateString() : null);

            return (
              <div
                key={licForm.formId}
                className={cn(
                  "rounded-lg border p-3 flex items-start gap-3",
                  isCompleted ? "bg-green-50 border-green-200" : ""
                )}
              >
                <Checkbox
                  id={licForm.formId}
                  checked={isCompleted}
                  onCheckedChange={(v) => handleToggle(licForm.formId, !!v)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <label htmlFor={licForm.formId} className="text-sm cursor-pointer leading-tight">
                    {licForm.label}
                  </label>
                  <div className="flex items-center gap-2 mt-0.5">
                    {licForm.required && (
                      <span className="text-xs text-muted-foreground">Required</span>
                    )}
                    {isCompleted && completedAt && (
                      <span className="text-xs text-green-600">Completed {completedAt}</span>
                    )}
                  </div>
                </div>
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Move-in checklist */}
      <div>
        <h2 className="text-sm font-medium mb-3">Move-In Checklist</h2>
        <div className="rounded-lg border overflow-hidden">
          {[
            "Room prepared and inspected",
            "Welcome packet provided",
            "Orientation completed",
            "Care plan reviewed with family",
            "Personal belongings inventoried",
            "Emergency contact confirmed",
          ].map((item) => (
            <label key={item} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/30 transition-colors">
              <Checkbox />
              <span className="text-sm">{item}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Convert to Resident */}
      <div className="pt-2">
        <Button
          disabled={!allRequiredComplete || convertMutation.isPending}
          onClick={() => convertMutation.mutate()}
        >
          {convertMutation.isPending ? "Converting..." : "Convert to Resident"}
        </Button>
        {!allRequiredComplete && (
          <p className="text-xs text-muted-foreground mt-2">
            Complete all required forms to enable conversion.
          </p>
        )}
      </div>
    </div>
  );
}

export default function AdmissionsPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: me } = useSession();

  const facilityNumber = me?.facilityNumber ?? "";

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (me === null) return null;

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <a
            href="/#/portal/crm"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            CRM
          </a>
        </div>
        <AdmissionsContent facilityNumber={facilityNumber} leadId={params.id!} />
      </div>
    </PortalLayout>
  );
}
