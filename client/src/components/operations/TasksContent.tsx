/**
 * TasksContent — facility-wide overdue tasks sub-view.
 *
 * Driven by GET /api/ops/facilities/:facilityNumber/overdue-tasks. Each row
 * surfaces the resident, the task, how late it is, and inline actions to
 * mark complete or refused — no need to first drill into a resident profile.
 *
 * Mirrors the loading / error / empty state shape of IncidentsContent so the
 * sub-view experience stays consistent across the dashboard.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AddTaskDialog } from "@/components/operations/AddTaskDialog";
import { ArrowLeft, ClipboardList, Plus, CheckCircle2, XCircle } from "lucide-react";

interface OverdueTask {
  id: number;
  residentId: number;
  residentName: string;
  roomNumber: string | null;
  taskName: string;
  taskType: string;
  scheduledTime: string | null;
  shift: string | null;
  assignedTo: string | null;
  status: string;
  taskDate: number;
}

function lateLabel(taskDate: number, scheduledTime: string | null): string {
  // Combine date + scheduled time for the most precise relative label.
  // Fall back to the date-only timestamp if no time is set.
  let ts = taskDate;
  if (scheduledTime) {
    const m = scheduledTime.match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      const d = new Date(taskDate);
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      ts = d.getTime();
    }
  }
  if (!Number.isFinite(ts)) return "—";
  return `${formatDistanceToNow(new Date(ts))} late`;
}

function ActionDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  label: string;
  placeholder: string;
  busy: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setText("");
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">{label}</label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="resize-none min-h-[100px]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(text)} disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({
  task,
  facilityNumber,
}: {
  task: OverdueTask;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [refuseOpen, setRefuseOpen] = useState(false);

  const invalidateAfterChange = () => {
    qc.invalidateQueries({
      queryKey: [`/api/ops/facilities/${facilityNumber}/overdue-tasks`],
    });
    qc.invalidateQueries({
      queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
    });
  };

  const completeMutation = useMutation({
    mutationFn: async (notes: string) => {
      const res = await apiRequest("PUT", `/api/ops/tasks/${task.id}/complete`, {
        notes,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast({ title: "Task marked complete" });
      setCompleteOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not complete task",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const refuseMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest("PUT", `/api/ops/tasks/${task.id}/refuse`, {
        reason,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast({ title: "Task marked refused" });
      setRefuseOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not refuse task",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div
      className="rounded-lg overflow-hidden flex items-start gap-3 p-3 hover:bg-[#F0F4FF] transition-colors"
      style={{ border: "1px solid #E0E7FF" }}
    >
      <div className="h-9 w-9 rounded-md bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
        <ClipboardList className="h-4 w-4 text-red-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{task.taskName}</span>
          <Badge
            variant="outline"
            className="h-5 text-[10px] font-semibold bg-red-100 text-red-700 border-red-200"
          >
            {lateLabel(task.taskDate, task.scheduledTime)}
          </Badge>
          {task.shift && (
            <Badge variant="outline" className="h-5 text-[10px] capitalize">
              {task.shift}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {task.residentName}
          {task.roomNumber ? ` · Rm ${task.roomNumber}` : ""}
          {task.scheduledTime ? ` · scheduled ${task.scheduledTime}` : ""}
          {task.assignedTo ? ` · assigned to ${task.assignedTo}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className={cn("h-8 gap-1.5")}
          onClick={() => setCompleteOpen(true)}
          disabled={completeMutation.isPending || refuseMutation.isPending}
          aria-label={`Mark ${task.taskName} complete`}
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Complete</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setRefuseOpen(true)}
          disabled={completeMutation.isPending || refuseMutation.isPending}
          aria-label={`Mark ${task.taskName} refused`}
        >
          <XCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Refused</span>
        </Button>
      </div>

      <ActionDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Mark task complete"
        label="Completion notes (optional)"
        placeholder="What was done, observations, etc."
        busy={completeMutation.isPending}
        onSubmit={(notes) => completeMutation.mutate(notes)}
      />
      <ActionDialog
        open={refuseOpen}
        onOpenChange={setRefuseOpen}
        title="Mark task refused"
        label="Reason"
        placeholder="Why was the task not performed?"
        busy={refuseMutation.isPending}
        onSubmit={(reason) => refuseMutation.mutate(reason)}
      />
    </div>
  );
}

export function TasksContent({
  facilityNumber,
  onBack,
}: {
  facilityNumber: string;
  onBack?: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  const { data: envelope, isLoading, error } = useQuery<
    { success: boolean; data: OverdueTask[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/overdue-tasks`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const tasks = envelope?.data ?? [];

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
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Overdue Tasks
        </h1>
        <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Task
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load overdue tasks.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            All clear — no overdue tasks.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} facilityNumber={facilityNumber} />
          ))}
        </div>
      )}

      <AddTaskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
