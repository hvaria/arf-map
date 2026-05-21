/**
 * <AttachEvidence> — Wave 0 F2 component (Phase 3 IA §2.1, Phase 4 §10).
 *
 * Used inside Wave 1 dialogs to attach photos/files/external links to any
 * ops entity. Mobile-first so a cook can capture from a kitchen tablet.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Mutation + invalidate + toast skeleton:        ComplianceContent.tsx:88-106
 *   - Loading skeleton row pattern:                  ComplianceContent.tsx:311-313
 *   - Error banner styling (network/storage fail):   ComplianceContent.tsx:305-307
 *   - Empty/empty-state dashed border:               ComplianceContent.tsx:315-318
 *   - <Button variant="gradient"> for primary CTA:   ComplianceContent.tsx:282
 *   - `apiRequest` / `getQueryFn` from queryClient:  lib/queryClient.ts
 *
 * Pre-save mode (entityId === undefined): files are buffered in local state.
 * Parent calls the exposed `flushAttach()` via ref after the parent row saves.
 * Post-save mode: POSTs immediately to /api/ops/evidence (multipart) and
 * refetches the list. Per Phase 3 §2.1 — removal after save is a real
 * audit-emitting DELETE (soft).
 *
 * API contract (Phase 4 §7.2):
 *   GET    /api/ops/facilities/:facilityNumber/evidence?entityType=&entityId=
 *   POST   /api/ops/evidence                   (multipart)
 *   DELETE /api/ops/evidence/:id
 */
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { getCsrfToken, refreshCsrfTokenFromMe } from "@/lib/csrfToken";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Paperclip,
  FileText,
  Image as ImageIcon,
  X,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";

// ── Public types ──────────────────────────────────────────────────────────────

export interface EvidenceRow {
  id: number;
  facilityNumber: string;
  entityType: string;
  entityId: number;
  kind: "file" | "photo" | "external_link";
  filename: string | null;
  mime: string | null;
  byteSize: number | null;
  storageUri: string;
  uploadedBy: string;
  uploadedAt: number;
  deletedAt: number | null;
}

export interface AttachEvidenceHandle {
  /**
   * Flush any pending File[] buffered in pre-save mode to the server,
   * tagged with the now-known parent entityId. Called by the parent form
   * after its create mutation resolves. Resolves with the list of created
   * evidence IDs; rejects if any upload fails.
   */
  flushAttach: (entityId: number) => Promise<number[]>;
  /** Count of files staged in pre-save mode but not yet POSTed. */
  pendingCount: number;
}

interface Props {
  entityType: string;
  /** Undefined while the parent form is creating a new row. */
  entityId: number | undefined;
  facilityNumber: string;
  /** Optional label override. Defaults per §2.1 wireframe. */
  triggerLabel?: string;
  className?: string;
}

// ── Constants per Phase 4 §8 ──────────────────────────────────────────────────

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png";
const ACCEPT_HINT = "PDF, JPG, PNG · 5 MB max each";

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(m: string | null | undefined): boolean {
  return !!m && m.startsWith("image/");
}

// Stable id for buffered pre-save items — used as React key and retry handle.
let _pendingSeq = 1;
function nextPendingId(): number {
  return _pendingSeq++;
}

interface PendingItem {
  id: number;
  file: File;
  error?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AttachEvidence = forwardRef<AttachEvidenceHandle, Props>(
  function AttachEvidence(
    { entityType, entityId, facilityNumber, triggerLabel, className },
    ref,
  ) {
    const { toast } = useToast();
    const qc = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // Pre-save buffer (entityId === undefined OR while server upload is in flight).
    const [pending, setPending] = useState<PendingItem[]>([]);

    // Post-save server list. Disabled when entityId is undefined.
    const listKey = [
      `/api/ops/facilities/${facilityNumber}/evidence`,
      { entityType, entityId },
    ] as const;

    const listQuery = useQuery<{
      success: boolean;
      data: EvidenceRow[];
    } | null>({
      queryKey: listKey,
      queryFn: async () => {
        const params = new URLSearchParams({
          entityType,
          entityId: String(entityId),
        });
        const res = await fetch(
          `/api/ops/facilities/${facilityNumber}/evidence?${params}`,
          { credentials: "include" },
        );
        if (res.status === 401) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      enabled: !!facilityNumber && typeof entityId === "number",
      staleTime: 60_000,
    });

    const evidenceList = listQuery.data?.data ?? [];

    // ── Upload a single File. Used both for post-save immediate and pre-save flush.
    const uploadFile = useCallback(
      async (file: File, knownEntityId: number): Promise<number> => {
        // Client-side guards mirror Phase 4 §8 server constraints.
        if (file.size > MAX_BYTES) {
          throw new Error("File exceeds 5 MB limit");
        }
        const fd = new FormData();
        fd.append("entityType", entityType);
        fd.append("entityId", String(knownEntityId));
        fd.append("kind", file.type.startsWith("image/") ? "photo" : "file");
        fd.append("file", file);
        // Multipart upload — bypass apiRequest() (JSON-only). Mirror its
        // CSRF behavior: sentinel header + per-session token + one-shot
        // 403-retry. See lib/csrfToken.ts.
        const buildHeaders = (): Record<string, string> => {
          const h: Record<string, string> = {
            "X-Requested-With": "XMLHttpRequest",
          };
          const csrf = getCsrfToken();
          if (csrf) h["X-CSRF-Token"] = csrf;
          return h;
        };
        const doPost = () =>
          fetch(`/api/ops/evidence`, {
            method: "POST",
            credentials: "include",
            headers: buildHeaders(),
            body: fd,
          });
        let res = await doPost();
        if (res.status === 403) {
          const probe = await res.clone().json().catch(() => null);
          if ((probe as { code?: string } | null)?.code === "CSRF_TOKEN_INVALID") {
            await refreshCsrfTokenFromMe("facility");
            res = await doPost();
          }
        }
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            msg = body?.message || body?.error || msg;
          } catch {
            /* swallow */
          }
          throw new Error(msg);
        }
        const json = (await res.json()) as { data?: { id: number } };
        // Release File reference once POST resolves — no client retention.
        return json?.data?.id ?? 0;
      },
      [entityType, facilityNumber],
    );

    // ── Post-save immediate upload mutation
    const uploadMutation = useMutation({
      mutationFn: async (file: File) => {
        if (typeof entityId !== "number") {
          throw new Error("Cannot upload before parent is saved");
        }
        return uploadFile(file, entityId);
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: listKey });
      },
      onError: (err: Error) => {
        toast({
          title: "Upload failed — please try again",
          description: err.message,
          variant: "destructive",
        });
      },
    });

    // ── Delete (soft) mutation with optimistic update + rollback
    const deleteMutation = useMutation({
      mutationFn: async (id: number) => {
        const res = await apiRequest("DELETE", `/api/ops/evidence/${id}`);
        return res.json();
      },
      onMutate: async (id: number) => {
        await qc.cancelQueries({ queryKey: listKey });
        const prev = qc.getQueryData<{ data: EvidenceRow[] }>(listKey);
        if (prev?.data) {
          qc.setQueryData(listKey, {
            ...prev,
            data: prev.data.filter((row) => row.id !== id),
          });
        }
        return { prev };
      },
      onError: (err: Error, _id, ctx) => {
        if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
        toast({
          title: "Couldn't remove attachment",
          description: err.message,
          variant: "destructive",
        });
      },
      onSettled: () => {
        qc.invalidateQueries({ queryKey: listKey });
      },
    });

    // ── Pending buffer operations (pre-save mode)
    const addPending = useCallback(
      (files: FileList | File[]) => {
        const arr = Array.from(files);
        const accepted: PendingItem[] = [];
        for (const file of arr) {
          if (file.size > MAX_BYTES) {
            toast({
              title: "File too large",
              description: `${file.name} exceeds the 5 MB limit.`,
              variant: "destructive",
            });
            continue;
          }
          if (
            file.type &&
            !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
          ) {
            toast({
              title: "Unsupported file type",
              description: `${file.name} — ${ACCEPT_HINT}.`,
              variant: "destructive",
            });
            continue;
          }
          accepted.push({ id: nextPendingId(), file });
        }
        if (accepted.length === 0) return;

        if (typeof entityId === "number") {
          // Post-save: upload each immediately. Use the staged list as a
          // transient visual indicator only — clear after success.
          for (const p of accepted) {
            uploadMutation.mutate(p.file, {
              onError: () => {
                // Keep in pending so the user sees the retry button.
                setPending((s) => [...s, { ...p, error: "Upload failed" }]);
              },
            });
          }
        } else {
          setPending((s) => [...s, ...accepted]);
        }
      },
      [entityId, uploadMutation, toast],
    );

    const removePending = useCallback((id: number) => {
      setPending((s) => s.filter((p) => p.id !== id));
    }, []);

    const retryPending = useCallback(
      (item: PendingItem) => {
        if (typeof entityId !== "number") return;
        // Drop the error, retry the upload.
        setPending((s) =>
          s.map((p) => (p.id === item.id ? { ...p, error: undefined } : p)),
        );
        uploadMutation.mutate(item.file, {
          onSuccess: () => removePending(item.id),
          onError: () => {
            setPending((s) =>
              s.map((p) =>
                p.id === item.id ? { ...p, error: "Upload failed" } : p,
              ),
            );
          },
        });
      },
      [entityId, uploadMutation, removePending],
    );

    // ── Public ref API for parent-driven post-save flush ────────────────────
    useImperativeHandle(
      ref,
      () => ({
        pendingCount: pending.length,
        flushAttach: async (newEntityId: number) => {
          const items = [...pending];
          const ids: number[] = [];
          for (const item of items) {
            try {
              const id = await uploadFile(item.file, newEntityId);
              ids.push(id);
              setPending((s) => s.filter((p) => p.id !== item.id));
            } catch (err) {
              setPending((s) =>
                s.map((p) =>
                  p.id === item.id
                    ? { ...p, error: (err as Error).message }
                    : p,
                ),
              );
              throw err;
            }
          }
          qc.invalidateQueries({ queryKey: listKey });
          return ids;
        },
      }),
      [pending, uploadFile, qc, listKey],
    );

    // ── Trigger handlers ────────────────────────────────────────────────────
    const onPickClick = () => {
      // Mobile: this opens the OS-native picker which surfaces camera capture.
      fileInputRef.current?.click();
    };
    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addPending(e.target.files);
      }
      // Reset so the same file can be re-picked after a remove.
      e.target.value = "";
    };

    const attachedCount = evidenceList.length + pending.length;
    const isUploading = uploadMutation.isPending;

    // ── Render ──────────────────────────────────────────────────────────────
    return (
      <div className={cn("space-y-2", className)} aria-label="Evidence">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="gradient"
            onClick={onPickClick}
            disabled={isUploading}
            aria-label="Add photo or file"
            data-testid="attach-evidence-add"
          >
            <Paperclip className="h-3.5 w-3.5 mr-1.5" />
            {triggerLabel ?? "Add photo or file"}
          </Button>
          {attachedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {attachedCount} attached
            </span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          // capture is honored on mobile browsers; desktop ignores.
          // Allow either camera or library — the OS picker decides.
          className="sr-only"
          onChange={onFileChange}
          aria-hidden="true"
          tabIndex={-1}
          data-testid="attach-evidence-input"
        />

        {/* Loading state: matches a populated row height to avoid layout shift. */}
        {listQuery.isLoading && typeof entityId === "number" && (
          <Skeleton className="h-10 w-full rounded-md" />
        )}

        {/* Network error on list */}
        {listQuery.error && (
          <div
            className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive flex items-center gap-1.5"
            role="alert"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Couldn't load attachments — please try again.
          </div>
        )}

        {/* Combined attached + pending list */}
        {(evidenceList.length > 0 || pending.length > 0) && (
          <ul className="space-y-1.5">
            {evidenceList.map((row) => (
              <li
                key={`saved-${row.id}`}
                className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-xs"
                data-testid="attach-evidence-row"
              >
                <span className="shrink-0 text-muted-foreground">
                  {isImageMime(row.mime) ? (
                    <ImageIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                  {row.filename ?? "(unnamed)"}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatBytes(row.byteSize)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(row.id)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Remove ${row.filename ?? "attachment"}`}
                  data-testid="attach-evidence-remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}

            {pending.map((p) => (
              <li
                key={`pending-${p.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                  p.error
                    ? "bg-destructive/5 border-destructive/40"
                    : "bg-amber-50 border-amber-200",
                )}
                data-testid="attach-evidence-pending"
              >
                <span className="shrink-0 text-muted-foreground">
                  {p.file.type.startsWith("image/") ? (
                    <ImageIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                  {p.file.name}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatBytes(p.file.size)}
                </span>
                {p.error ? (
                  <>
                    <span className="text-[10px] text-destructive font-medium">
                      Upload failed — please try again
                    </span>
                    <button
                      type="button"
                      onClick={() => retryPending(p)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={`Retry uploading ${p.file.name}`}
                      data-testid="attach-evidence-retry"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    Pending save
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePending(p.id)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Remove ${p.file.name}`}
                  data-testid="attach-evidence-remove-pending"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground">{ACCEPT_HINT}</p>
      </div>
    );
  },
);
