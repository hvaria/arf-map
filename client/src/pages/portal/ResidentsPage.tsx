import { useEffect } from "react";
import { useLocation } from "wouter";
import PortalLayout from "./PortalLayout";
import { useSession } from "@/hooks/useSession";
import { ResidentsContent } from "@/components/operations/ResidentsContent";

// Re-export the canonical Content from its new home so existing
// `import { ResidentsContent } from "@/pages/portal/ResidentsPage"` paths
// keep working until Phase D removes them.
export { ResidentsContent };

export default function ResidentsPage() {
  const [, navigate] = useLocation();

  const { data: me } = useSession();

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
