import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import PortalLayout from "./PortalLayout";
import { useSession } from "@/hooks/useSession";
import { AdmissionsContent } from "@/components/operations/AdmissionsContent";
import { ArrowLeft } from "lucide-react";

// Re-export for legacy import paths until Phase D removes them.
export { AdmissionsContent };

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
