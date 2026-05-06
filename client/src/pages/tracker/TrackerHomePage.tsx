/**
 * Tracker home page — chrome wrapper around `TrackerShell`.
 *
 * Routes:
 *   /portal/tracker/:slug         → renders default tab from definition
 *   /portal/tracker/:slug/:tab    → renders requested tab (quick|detailed|history)
 *
 * 404 page when the slug isn't in the registry.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import PortalLayout from "@/pages/portal/PortalLayout";
import { getQueryFn } from "@/lib/queryClient";
import { useTrackerDefinition } from "@/lib/tracker/useTrackerDefinition";
import { TrackerShell } from "@/components/tracker/TrackerShell";
import { TrackerLoading } from "@/components/tracker/TrackerLoading";
import { TrackerEmpty } from "@/components/tracker/TrackerEmpty";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

export default function TrackerHomePage() {
  const [, navigate] = useLocation();
  const [, paramsTab] = useRoute<{ slug: string; tab: string }>(
    "/portal/tracker/:slug/:tab",
  );
  const [, paramsBase] = useRoute<{ slug: string }>("/portal/tracker/:slug");

  const slug = paramsTab?.slug ?? paramsBase?.slug;
  const tab = paramsTab?.tab;

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  const { data, isLoading, isError } = useTrackerDefinition(slug);

  if (!me) return null;

  return (
    <PortalLayout>
      {isLoading ? (
        <TrackerLoading rows={4} />
      ) : isError || !data?.data ? (
        <div className="space-y-3">
          <TrackerEmpty
            title="Tracker not found"
            hint={`No tracker with slug "${slug}" is registered for your facility.`}
          />
          <div className="text-center">
            <Link href="/portal/tracker">
              <Button variant="outline" size="sm">
                Back to all trackers
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <TrackerShell definition={data.data} tab={tab} />
      )}
    </PortalLayout>
  );
}
