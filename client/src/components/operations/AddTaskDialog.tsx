/**
 * AddTaskDialog — direct task creation, independent of care plans.
 *
 * Backed by POST /api/ops/tasks. On success, invalidates calendar +
 * dashboard queries so the new row shows up everywhere immediately.
 *
 * Resident list is fetched lazily when the dialog opens. The dialog has no
 * external dependencies beyond a portal session — anyone who can mount it
 * gets a working "Add Task" affordance.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useResidents } from "@/hooks/useResidents";
import { todayLocal, toLocalEpochMs } from "@/lib/datetime";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FormField, onSubmitKey } from "@/components/operations/FormField";

export function AddTaskDialog({
  open,
  onOpenChange,
  facilityNumber,
  defaultResidentId,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  defaultResidentId?: number;
  defaultDate?: string; // YYYY-MM-DD
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [residentId, setResidentId] = useState<string>(
    defaultResidentId ? String(defaultResidentId) : "",
  );
  const [taskName, setTaskName] = useState("");
  const [taskType, setTaskType] = useState("manual");
  const [taskDate, setTaskDate] = useState(defaultDate ?? todayLocal());
  const [scheduledTime, setScheduledTime] = useState("");
  const [assignedTo, setAssignedTo] = useState("");

  // Reset form whenever the dialog re-opens — keeps the next entry clean.
  useEffect(() => {
    if (!open) return;
    setResidentId(defaultResidentId ? String(defaultResidentId) : "");
    setTaskName("");
    setTaskType("manual");
    setTaskDate(defaultDate ?? todayLocal());
    setScheduledTime("");
    setAssignedTo("");
  }, [open, defaultResidentId, defaultDate]);

  const { residents } = useResidents(facilityNumber);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        residentId: Number(residentId),
        taskName: taskName.trim(),
        taskType: taskType.trim() || "manual",
        taskDate: toLocalEpochMs(taskDate),
      };
      if (scheduledTime) body.scheduledTime = scheduledTime;
      if (assignedTo.trim()) body.assignedTo = assignedTo.trim();
      const res = await apiRequest("POST", `/api/ops/tasks`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task added" });
      // Refresh anything that surfaces tasks: calendar feed, dashboard
      // counts, resident task lists.
      void qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            typeof k === "string" &&
            (k.startsWith(`/api/ops/facilities/${facilityNumber}/calendar`) ||
              k.startsWith(`/api/ops/facilities/${facilityNumber}/dashboard`) ||
              k.startsWith(`/api/ops/residents/`))
          );
        },
      });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't add task", description: e.message, variant: "destructive" });
    },
  });

  const canSubmit =
    !!residentId &&
    taskName.trim().length > 0 &&
    !!taskDate &&
    !mutation.isPending;

  // Field-level errors only after the first submit attempt — UX-1.
  const [showErrors, setShowErrors] = useState(false);
  const errors = {
    residentId: !residentId ? "Pick a resident" : undefined,
    taskName: taskName.trim().length === 0 ? "What's the task?" : undefined,
    taskDate: !taskDate ? "Pick a date" : undefined,
  };
  const isValid = !errors.residentId && !errors.taskName && !errors.taskDate;
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
          <DialogTitle>Add task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Resident" required error={showErrors ? errors.residentId : undefined}>
            <Select value={residentId} onValueChange={setResidentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select resident…" />
              </SelectTrigger>
              <SelectContent>
                {residents.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No active residents
                  </div>
                ) : (
                  residents.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.firstName} {r.lastName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Task" required error={showErrors ? errors.taskName : undefined}>
            <Input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Vitals check, repositioning, ADL support…"
              autoFocus
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required error={showErrors ? errors.taskDate : undefined}>
              <Input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
              />
            </FormField>
            <FormField
              label="Time"
              hint="Leave blank for all-day"
            >
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <Input
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                placeholder="manual"
              />
            </FormField>
            <FormField label="Assign to">
              <Input
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Caregiver name"
              />
            </FormField>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding…" : "Add task"}
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
