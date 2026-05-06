/**
 * Tracker landing page — grid of cards, one per active tracker definition.
 *
 * Mirrors the chrome of other portal pages by reusing `PortalLayout`.
 * Foundation slice: only ADL renders. As trackers 2..25 land, they appear
 * automatically by virtue of being registered in `TRACKER_REGISTRY`.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PortalLayout from "@/pages/portal/PortalLayout";
import { getQueryFn } from "@/lib/queryClient";
import { useTrackerDefinitions } from "@/lib/tracker/useTrackerDefinitions";
import { TrackerCard } from "@/components/tracker/TrackerCard";
import { TrackerCardSkeleton } from "@/components/tracker/TrackerLoading";
import { TrackerEmpty } from "@/components/tracker/TrackerEmpty";
import { ClipboardList } from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

export default function TrackerLandingPage() {
  const [, navigate] = useLocation();

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  const { data, isLoading, isError } = useTrackerDefinitions();

  if (!me) return null;

  return (
    <PortalLayout>
      <div className="space-y-5">
        <header>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">Trackers</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Document daily care, vitals, ADLs, and more — pick a tracker to
                start charting.
              </p>
            </div>
          </div>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <TrackerCardSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          <TrackerEmpty
            title="Couldn't load trackers"
            hint="Try refreshing the page."
          />
        ) : !data?.data || data.data.length === 0 ? (
          <TrackerEmpty
            title="No trackers configured for your facility"
            hint="Trackers are added centrally — check back soon."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.data.map((def) => (
              <TrackerCard key={def.slug} definition={def} />
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
