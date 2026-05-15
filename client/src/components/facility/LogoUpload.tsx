/**
 * <LogoUpload> — facility-owned logo uploader for the My Details tab.
 *
 * This component manages the CUSTOMER FACILITY's own logo. It is NOT the
 * arf-map app brand identity (that lives in `client/src/components/BrandLogo.tsx`
 * and is explicitly out of scope here). The two concepts share the word
 * "logo" but write to different surfaces:
 *   - BrandLogo: hard-coded SVG/wordmark for the arf-map product chrome.
 *   - LogoUpload: per-facility upload that renders on the public listing
 *     and on every downloaded PDF report's letterhead.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - File picker + drop-zone shape + mime/size client guard:
 *       client/src/components/operations/AttachEvidence.tsx:349-399 (input wiring)
 *       client/src/components/operations/AttachEvidence.tsx:246-290 (validation)
 *   - Toast-on-rejection:
 *       client/src/components/operations/AttachEvidence.tsx:252-268
 *   - `apiRequest` / `getQueryFn` (kept JSON-only — multipart uses raw fetch):
 *       client/src/lib/queryClient.ts
 *
 * Allowed mimes + max bytes are imported from shared/facility-profile.ts so
 * the FE and BE share a single source of truth (no drift).
 */
import { useRef } from "react";
import {
  FACILITY_LOGO_ALLOWED_MIMES,
  FACILITY_LOGO_MAX_BYTES,
} from "@shared/facility-profile";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ImageIcon, Trash2, Upload } from "lucide-react";

interface Props {
  /**
   * URL to display the current logo. Pass null to render the empty state.
   * Callers should cache-bust this with `?t=<logoUpdatedAt>` so a fresh
   * upload triggers a re-fetch by the browser.
   */
  currentLogoUrl: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  loading?: boolean;
  className?: string;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const ACCEPT = FACILITY_LOGO_ALLOWED_MIMES.join(",");

export function LogoUpload({
  currentLogoUrl,
  onUpload,
  onRemove,
  loading = false,
  className,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function validate(file: File): string | null {
    if (file.size > FACILITY_LOGO_MAX_BYTES) {
      return `Logo must be smaller than ${formatMB(FACILITY_LOGO_MAX_BYTES)}.`;
    }
    if (
      file.type &&
      !(FACILITY_LOGO_ALLOWED_MIMES as readonly string[]).includes(file.type)
    ) {
      return "Use PNG, JPEG, or SVG.";
    }
    return null;
  }

  async function handleFile(file: File) {
    const err = validate(file);
    if (err) {
      toast({
        title: "Couldn't upload logo",
        description: err,
        variant: "destructive",
      });
      return;
    }
    try {
      await onUpload(file);
    } catch (e) {
      // Parent toasts on its own mutation; we just defend against unhandled.
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast({
        title: "Upload failed",
        description: msg,
        variant: "destructive",
      });
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so the same file can be re-picked after a remove.
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className={cn("space-y-3", className)} aria-label="Facility logo">
      <div
        role="region"
        aria-label="Facility logo upload"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={cn(
          "flex items-center gap-4 rounded-lg border border-dashed bg-white p-4",
          "transition-colors",
          loading ? "opacity-60" : "hover:border-stone-400",
        )}
        style={{ borderColor: "var(--portal-border-subtle)" }}
        data-testid="logo-upload-zone"
      >
        <div
          className="h-20 w-20 shrink-0 rounded-md border bg-stone-50 flex items-center justify-center overflow-hidden"
          style={{ borderColor: "var(--portal-border-subtle)" }}
          aria-hidden={!currentLogoUrl}
        >
          {currentLogoUrl ? (
            <img
              src={currentLogoUrl}
              alt="Current facility logo"
              className="max-h-full max-w-full object-contain"
              data-testid="logo-upload-preview"
            />
          ) : (
            <ImageIcon
              className="h-8 w-8 text-stone-400"
              aria-hidden="true"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-900">
            {currentLogoUrl ? "Replace logo" : "Upload your facility logo"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            Appears in your public listing and on every downloaded PDF
            report. PNG, JPEG, or SVG · {formatMB(FACILITY_LOGO_MAX_BYTES)}{" "}
            max.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              aria-label={currentLogoUrl ? "Replace logo" : "Upload logo"}
              data-testid="logo-upload-pick"
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {currentLogoUrl ? "Replace" : "Choose file"}
            </Button>
            {currentLogoUrl && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRemove()}
                disabled={loading}
                aria-label="Remove logo"
                data-testid="logo-upload-remove"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={onChange}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="logo-upload-input"
      />
    </div>
  );
}
