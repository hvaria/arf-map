import { useState, useMemo, useCallback } from "react";
import { MapView } from "@/components/MapView";
import { FacilityPanel } from "@/components/FacilityPanel";
import { JobsPanel } from "@/components/JobsPanel";
import { SearchBar } from "@/components/SearchBar";
import { FilterBar } from "@/components/FilterBar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Building2, Briefcase, LogIn } from "lucide-react";
import facilitiesData from "@/data/facilities.json";
import type { Facility } from "@shared/schema";

const facilities = facilitiesData as Facility[];

export default function MapPage() {
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    new Set(["LICENSED", "PENDING", "ON PROBATION"])
  );
  const [hiringOnly, setHiringOnly] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [capacityFilters, setCapacityFilters] = useState<Set<string>>(new Set());
  const [facilityType, setFacilityType] = useState<"small" | "large" | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const filteredFacilities = useMemo(() => {
    let result = facilities;
    if (statusFilters.size > 0)
      result = result.filter((f) => statusFilters.has(f.status));
    if (hiringOnly)
      result = result.filter((f) => f.isHiring);
    if (capacityFilters.size > 0)
      result = result.filter((f) => {
        if (capacityFilters.has(String(f.capacity))) return true;
        if (capacityFilters.has("7+") && f.capacity >= 7) return true;
        return false;
      });
    if (facilityType === "small") result = result.filter((f) => f.capacity <= 6);
    if (facilityType === "large") result = result.filter((f) => f.capacity >= 7);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.address.toLowerCase().includes(q) ||
          f.city.toLowerCase().includes(q) ||
          f.zip.includes(q) ||
          f.licensee.toLowerCase().includes(q) ||
          f.number.includes(q)
      );
    }
    return result;
  }, [searchQuery, statusFilters, hiringOnly, capacityFilters, facilityType]);

  const handleSelectFacility = useCallback((facility: Facility) => {
    setSelectedFacility(facility);
    setPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedFacility(null), 300);
  }, []);

  const handleToggleStatus = useCallback((status: string) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const handleToggleHiring = useCallback(() => setHiringOnly((p) => !p), []);

  const handleToggleCapacity = useCallback((cap: string) => {
    setCapacityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }, []);

  const handleClearAdvanced = useCallback(() => {
    setCapacityFilters(new Set());
    setFacilityType(null);
  }, []);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background" data-testid="map-page">

      {/* ── Map area (left, flex-1) ── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Floating header: search + filters + mobile login */}
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <div className="p-3 flex items-start gap-2">
            <div className="flex flex-col gap-2 pointer-events-auto max-w-md w-full">
              <SearchBar value={searchQuery} onChange={setSearchQuery} />
              <FilterBar
                activeFilters={statusFilters}
                onToggle={handleToggleStatus}
                hiringOnly={hiringOnly}
                onToggleHiring={handleToggleHiring}
                capacityFilters={capacityFilters}
                onToggleCapacity={handleToggleCapacity}
                facilityType={facilityType}
                onSetFacilityType={setFacilityType}
                onClearAdvanced={handleClearAdvanced}
                totalCount={facilities.length}
                filteredCount={filteredFacilities.length}
              />
            </div>
            {/* Mobile-only login button */}
            <div className="pointer-events-auto ml-auto">
              <Button
                variant="outline"
                size="sm"
                className="md:hidden bg-background/90 backdrop-blur-sm shadow-sm"
                onClick={() => setLoginDialogOpen(true)}
              >
                <LogIn className="h-4 w-4 mr-1.5" />
                Login
              </Button>
            </div>
          </div>
        </div>

        {/* Map */}
        <MapView
          facilities={filteredFacilities}
          selectedFacility={selectedFacility}
          onSelectFacility={handleSelectFacility}
        />

        {/* Facility detail bottom sheet — only when a facility is selected */}
        <FacilityPanel
          facility={selectedFacility}
          open={panelOpen}
          onClose={handleClosePanel}
        />
      </div>

      {/* ── Right sidebar: all open positions ── */}
      <aside className="hidden md:flex flex-col w-80 shrink-0 border-l bg-background z-10">
        {/* Sidebar header */}
        <div className="px-4 py-3 border-b shrink-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">ARF Map</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setLoginDialogOpen(true)}
          >
            <LogIn className="h-3.5 w-3.5 mr-1" />
            Login
          </Button>
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
                  <p className="text-xs text-muted-foreground mt-0.5">Browse & apply for positions</p>
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
