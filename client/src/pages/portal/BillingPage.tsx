import { useEffect } from "react";
import { useLocation } from "wouter";
import PortalLayout from "./PortalLayout";
import { useSession } from "@/hooks/useSession";
import { BillingContent } from "@/components/operations/BillingContent";

// Re-export for legacy import paths until Phase D removes them.
export { BillingContent };

export default function BillingPage() {
  const [, navigate] = useLocation();

  const { data: me } = useSession();

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
