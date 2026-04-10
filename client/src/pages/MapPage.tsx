import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapView } from "@/components/MapView";
import { FacilityPanel } from "@/components/FacilityPanel";
import { JobsPanel } from "@/components/JobsPanel";
import { SearchBar } from "@/components/SearchBar";
import { FilterPanel, DEFAULT_FILTERS, countActiveFilters, type FacilityFilters } from "@/components/FilterPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Building2, Briefcase, LogIn, BarChart2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useFacilities } from "@/hooks/useFacilities";
import type { Facility } from "@shared/schema";

export default function MapPage() {
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [filters, setFilters] = useState<FacilityFilters>(DEFAULT_FILTERS);

  // Facilities with server-side filters applied
  const { facilities, isLoading: facilitiesLoading } = useFacilities(filters);

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
    <div className="h-screen w-screen flex overflow-hidden bg-background" data-testid="map-page">

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
        />

        {/* Facility detail bottom sheet */}
        <FacilityPanel
          facility={selectedFacility}
          open={panelOpen}
          onClose={handleClosePanel}
        />
      </div>

      {/* ── Right sidebar ── */}
      <aside className="hidden md:flex flex-col w-80 shrink-0 border-l bg-background z-10">
        {/* Sidebar header */}
        <div className="px-4 py-3 shrink-0 flex items-center justify-between gap-2" style={{ background: "var(--brand-white)", borderBottom: "1px solid var(--brand-border)", fontFamily: "'Nunito', sans-serif" }}>
          <BrandLogo />
          <div className="flex items-center gap-1">
            <a href="/#/stats">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                <BarChart2 className="h-3 w-3" />
                Stats
              </Button>
            </a>
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
        </div>

        <JobsPanel
          selectedFacility={selectedFacility}
          onSelectFacility={handleSelectFacility}
        />
      </aside>

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
