import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapView } from "@/components/MapView";
import { FacilityPanel } from "@/components/FacilityPanel";
import { JobsPanel } from "@/components/JobsPanel";
import { NearbySheet } from "@/components/NearbySheet";
import { SearchBar } from "@/components/SearchBar";
import { SearchResultsList } from "@/components/SearchResultsList";
import { FilterPanel, DEFAULT_FILTERS, countActiveFilters, type FacilityFilters } from "@/components/FilterPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Building2, Briefcase, LogIn, MapPin } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useFacilities } from "@/hooks/useFacilities";
import type { NearbyArea } from "@/hooks/useFacilities";
import type { Facility } from "@shared/schema";

export default function MapPage() {
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [filters, setFilters] = useState<FacilityFilters>(DEFAULT_FILTERS);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [circleCenter, setCircleCenter] = useState<{ lat: number; lng: number } | null>(null);

  // Bound API queries to a 30-mile area around the current circleCenter
  // (set either by geolocation on mount or by the "Search this area" button).
  // Until we have a center, the API returns the full dataset. The hook
  // automatically suppresses the bbox when a search query is active so name/
  // license-# searches still match statewide.
  const nearby = useMemo<NearbyArea | null>(
    () => (circleCenter ? { lat: circleCenter.lat, lng: circleCenter.lng, radiusMiles: 30 } : null),
    [circleCenter]
  );

  // Facilities with server-side filters applied
  const { facilities, isLoading: facilitiesLoading } = useFacilities(filters, nearby);

  // Geolocation on mount — fly to user if granted, fall back to California default
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        setCircleCenter(loc);
      },
      () => {
        // Permission denied or unavailable — stay at California default
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const handleSearchArea = useCallback((lat: number, lng: number) => {
    setCircleCenter({ lat, lng });
  }, []);

  // First-load CTA: dismissed once user takes any action (geolocates, pans
  // and clicks "Search this area", types a query, or explicitly closes it).
  const [areaCtaDismissed, setAreaCtaDismissed] = useState(false);
  const showAreaCta =
    !circleCenter &&
    !areaCtaDismissed &&
    !filters.search.trim();

  const requestGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      setAreaCtaDismissed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        setCircleCenter(loc);
        setAreaCtaDismissed(true);
      },
      () => {
        // User denied — keep CTA visible so they can use Search this area
        // button after panning, but hide the geolocate button.
        setAreaCtaDismissed(true);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const { user: jobSeeker } = useAuth();

  const { data: jobSeekerProfile } = useQuery<{ profilePictureUrl?: string | null; firstName?: string | null } | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!jobSeeker,
  });

  const { data: facilityUser } = useQuery<{ id: number; facilityNumber: string; username: string } | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const handleSelectFacility = useCallback((facility: Facility) => {
    setSelectedFacility(facility);
    setPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedFacility(null), 300);
  }, []);

  const activeFilterCount = countActiveFilters(filters);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background" data-testid="map-page">

      {/* ── Top navbar ── */}
      <header className="flex items-center justify-between px-4 h-18 border-b bg-[oklch(95.7%_0.038_77.164_/_0.8))] backdrop-blur-sm z-50 flex-shrink-0">
        <BrandLogo size={80} />
        <div className="hidden md:flex items-center gap-1">
          {jobSeeker ? (
            <a href="/#/job-seeker">
              <Button variant="outline" size="sm" className="h-7 text-xs flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full border border-border overflow-hidden flex items-center justify-center flex-shrink-0">
                  {jobSeekerProfile?.profilePictureUrl ? (
                    <img src={jobSeekerProfile.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[8px] font-semibold text-foreground">
                      {jobSeeker.email[0].toUpperCase()}
                    </span>
                  )}
                </div>
                {jobSeekerProfile?.firstName ?? jobSeeker.email.split("@")[0]}
              </Button>
            </a>
          ) : facilityUser ? (
            <a href="/#/facility-portal">
              <Button variant="outline" size="sm" className="h-7 text-xs flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full border border-border overflow-hidden flex items-center justify-center flex-shrink-0 bg-primary/10">
                  <Building2 className="h-2.5 w-2.5 text-primary" />
                </div>
                {facilityUser.username}
              </Button>
            </a>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setLoginDialogOpen(true)}
            >
              <LogIn className="h-3.5 w-3.5 mr-1" />
              Login
            </Button>
          )}
        </div>
      </header>

      {/* ── Main content (map + sidebar) ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Map area (left, flex-1) ── */}
        <div className="flex-1 relative overflow-hidden">

          {/* Floating header: search + filters + mobile login */}
          <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
            <div className="p-3 flex items-start gap-2">
              <div className="flex flex-col gap-2 pointer-events-auto max-w-md w-full">
                <SearchBar
                  value={filters.search}
                  onChange={(search) => setFilters((f) => ({ ...f, search }))}
                />
                {showAreaCta && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/95 backdrop-blur-sm border border-border/60 shadow-md text-sm">
                    <MapPin className="h-4 w-4 shrink-0 text-primary" />
                    <span className="flex-1 leading-tight">
                      Showing all California facilities. Search your area for a faster view.
                    </span>
                    <button
                      type="button"
                      onClick={requestGeolocation}
                      className="text-xs font-semibold px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 shrink-0"
                      data-testid="cta-search-your-area"
                    >
                      Use my location
                    </button>
                    <button
                      type="button"
                      onClick={() => setAreaCtaDismissed(true)}
                      className="text-xs text-muted-foreground hover:text-foreground shrink-0 px-1"
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Filter panel toggle */}
                  <FilterPanel
                    filters={filters}
                    onChange={setFilters}
                    totalShowing={facilities.length}
                  />

                  {/* Quick status pills */}
                  {(["LICENSED", "PENDING", "ON PROBATION", "CLOSED"] as const).map((status) => {
                    const colors: Record<string, string> = {
                      LICENSED: "bg-green-500",
                      PENDING: "bg-amber-500",
                      "ON PROBATION": "bg-purple-500",
                      CLOSED: "bg-red-500",
                    };
                    const labels: Record<string, string> = {
                      LICENSED: "Licensed",
                      PENDING: "Pending",
                      "ON PROBATION": "Probation",
                      CLOSED: "Closed",
                    };
                    const active = filters.statuses.has(status);
                    return (
                      <button
                        key={status}
                        onClick={() => {
                          const next = new Set(filters.statuses);
                          if (next.has(status)) next.delete(status);
                          else next.add(status);
                          setFilters((f) => ({ ...f, statuses: next }));
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border shadow-sm ${
                          active
                            ? "bg-background/95 backdrop-blur-sm border-border/60 text-foreground"
                            : "bg-background/60 backdrop-blur-sm border-transparent text-muted-foreground opacity-60"
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status]} ${!active ? "opacity-40" : ""}`} />
                        {labels[status]}
                      </button>
                    );
                  })}

                  {/* Hiring quick filter */}
                  <button
                    onClick={() => setFilters((f) => ({ ...f, hiringOnly: !f.hiringOnly }))}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border shadow-sm ${
                      filters.hiringOnly
                        ? "bg-blue-50 dark:bg-blue-950 backdrop-blur-sm border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                        : "bg-background/60 backdrop-blur-sm border-transparent text-muted-foreground opacity-60"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 bg-blue-500 ${!filters.hiringOnly ? "opacity-40" : ""}`} />
                    Hiring
                  </button>

                  {/* Count */}
                  <span className="text-xs text-muted-foreground ml-1 bg-background/80 backdrop-blur-sm px-2 py-1 rounded-full shadow-sm border border-border/40">
                    {facilitiesLoading ? "…" : `${facilities.length.toLocaleString()} shown`}
                  </span>
                </div>
              </div>

              {/* Mobile-only: account/login button */}
              <div className="pointer-events-auto ml-auto md:hidden">
                {jobSeeker ? (
                  <a href="/#/job-seeker">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-background/90 backdrop-blur-sm shadow-sm flex items-center gap-1.5"
                    >
                      <div className="w-5 h-5 rounded-full border border-border overflow-hidden flex items-center justify-center flex-shrink-0">
                        {jobSeekerProfile?.profilePictureUrl ? (
                          <img src={jobSeekerProfile.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[9px] font-semibold text-foreground">
                            {jobSeeker.email[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                      Account
                    </Button>
                  </a>
                ) : facilityUser ? (
                  <a href="/#/facility-portal">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-background/90 backdrop-blur-sm shadow-sm flex items-center gap-1.5"
                    >
                      <div className="w-5 h-5 rounded-full border border-border overflow-hidden flex items-center justify-center flex-shrink-0 bg-primary/10">
                        <Building2 className="h-3 w-3 text-primary" />
                      </div>
                      My Facility
                    </Button>
                  </a>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-background/90 backdrop-blur-sm shadow-sm"
                    onClick={() => setLoginDialogOpen(true)}
                  >
                    <LogIn className="h-4 w-4 mr-1.5" />
                    Login
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Map */}
          <MapView
            facilities={facilities}
            selectedFacility={selectedFacility}
            onSelectFacility={handleSelectFacility}
            userLocation={userLocation}
            circleCenter={circleCenter}
            onSearchArea={handleSearchArea}
          />

          {/* Facility detail bottom sheet */}
          <FacilityPanel
            facility={selectedFacility}
            open={panelOpen}
            onClose={handleClosePanel}
            userLocation={userLocation}
          />

          {/* Mobile-only open positions sheet */}
          <NearbySheet
            onSelectFacility={handleSelectFacility}
            hidden={panelOpen}
          />
        </div>

        {/* ── Right sidebar ── */}
        <aside className="hidden md:flex flex-col w-80 shrink-0 border-l bg-background z-10">
          {filters.search.trim() ? (
            <SearchResultsList
              facilities={facilities}
              selectedFacility={selectedFacility}
              onSelectFacility={handleSelectFacility}
              query={filters.search.trim()}
            />
          ) : (
            <JobsPanel
              selectedFacility={selectedFacility}
              onSelectFacility={handleSelectFacility}
            />
          )}
        </aside>
      </div>

      {/* ── Role selection dialog ── */}
      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Welcome — who are you?</DialogTitle>
            <DialogDescription>Choose your portal to continue.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <a href="/#/job-seeker" onClick={() => setLoginDialogOpen(false)}>
              <button className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 p-5 transition-all text-center group">
                <Briefcase className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                <div>
                  <p className="font-semibold text-sm">Job Seeker</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Browse &amp; apply for positions</p>
                </div>
              </button>
            </a>
            <a href="/#/facility-portal" onClick={() => setLoginDialogOpen(false)}>
              <button className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 p-5 transition-all text-center group">
                <Building2 className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                <div>
                  <p className="font-semibold text-sm">Facility Portal</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Manage your listing</p>
                </div>
              </button>
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
