/**
 * Standalone Notes page for the portal — wraps the embedded NotesContent
 * component (originally written for OperationsTab) inside PortalLayout so it
 * can be linked to from the dashboard, nav, and keyboard shortcut g+n.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import PortalLayout from "./PortalLayout";
import { NotesContent } from "./NotesPage";
import { useSession } from "@/hooks/useSession";

export default function NotesPortalPage() {
  const [, navigate] = useLocation();
  const { data: me } = useSession();

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (!me) return null;

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Notes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operational communication for Facility #{me.facilityNumber}
          </p>
        </div>
        <NotesContent facilityNumber={me.facilityNumber} embedded />
      </div>
    </PortalLayout>
  );
}
