import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/queryClient";

/**
 * DownloadResumeButton — generates and downloads the signed-in seeker's
 * resume PDF from their saved profile data.
 *
 * The PDF is produced entirely server-side from the canonical profile rows
 * (see `GET /api/jobseeker/resume.pdf`); this button only triggers the
 * request, surfaces loading / success / error states, and hands the streamed
 * blob to the browser's download flow.
 *
 * Incomplete profiles: the server returns 422 RESUME_INCOMPLETE when the
 * profile has no name (a nameless resume isn't useful). We surface that as a
 * guiding toast — every other empty field is best-effort-omitted server-side,
 * so the download otherwise always succeeds.
 */
export function DownloadResumeButton({
  variant = "outline",
  size = "sm",
  className,
}: {
  variant?: "default" | "outline" | "secondary";
  size?: "sm" | "default";
  className?: string;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/jobseeker/resume.pdf`, {
        method: "GET",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });

      if (!res.ok) {
        // Error responses are the canonical JSON envelope { code, message }.
        let message = "Could not generate your resume. Please try again.";
        let code = "";
        try {
          const body = await res.json();
          message = body?.message || message;
          code = body?.code || "";
        } catch {
          /* non-JSON error body — keep the generic message */
        }
        if (code === "RESUME_INCOMPLETE") {
          toast({
            title: "Finish your profile first",
            description: message,
            variant: "destructive",
          });
        } else if (res.status === 401) {
          toast({
            title: "Please sign in again",
            description: "Your session expired. Sign in to download your resume.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Download failed", description: message, variant: "destructive" });
        }
        return;
      }

      // Stream → blob → click a transient object-URL anchor.
      const blob = await res.blob();
      const filename = parseFilename(res.headers.get("Content-Disposition")) ?? "resume.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so the download has committed.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast({ title: "Resume downloaded", description: filename });
    } catch (err: any) {
      toast({
        title: "Download failed",
        description: err?.message ?? "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleDownload}
      disabled={loading}
      aria-busy={loading}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-1.5" />
      )}
      {loading ? "Preparing…" : "Download Resume"}
    </Button>
  );
}

/** Pull the filename out of a `Content-Disposition: attachment; filename="x"`. */
function parseFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1]) : undefined;
}
