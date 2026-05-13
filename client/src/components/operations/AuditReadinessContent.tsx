/**
 * AuditReadinessContent — top-level sub-view for the audit-readiness hub.
 *
 * Wave 0 mount: brings the new sub-view into the OperationsTab sidebar so
 * Reg Settings (Wave 0 A11) is reachable from the running app. The tab
 * shell reuses the existing `portal-tabs` wrapper around shadcn `Tabs`
 * (mirror of StaffContent.tsx:386-391).
 *
 * Wave 1 fills Drills / Logs / Vendors / Complaints / Inspections with
 * real content (Epic B B1-B11). Until then those tabs render a tight
 * "Coming in Wave 1" placeholder so the IA is visible and clickable.
 *
 * Visual language: page heading style + back link follow
 * ComplianceContent.tsx:270-281. Settings cog icon uses lucide `Settings`
 * to mirror the Phase 3 §1.3 IA decision (⚙ = Admin-only Reg Settings).
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, ArrowLeft, Settings } from "lucide-react";
import { RegSettingsContent } from "@/components/operations/RegSettingsContent";

interface Props {
  facilityNumber: string;
  onBack?: () => void;
}

const PLACEHOLDER_TABS: Array<{ key: string; label: string; copy: string }> = [
  {
    key: "drills",
    label: "Drills",
    copy: "Fire and disaster drill log ships in Wave 1 (W5). You'll be able to log a drill with shift, scenario, leader, participants, evacuation time, and debrief notes.",
  },
  {
    key: "logs",
    label: "Logs",
    copy: "Temperature logs (fridge, freezer, hot water) ship in Wave 1 (W7). Out-of-range readings auto-flag and create a follow-up.",
  },
  {
    key: "vendors",
    label: "Vendors",
    copy: "Vendor COI tracker ships in Wave 1 (W9). One row per vendor with COI expiry and renewal nudge.",
  },
  {
    key: "complaints",
    label: "Complaints",
    copy: "Complaint intake → investigation → resolution ships in Wave 1 (W10). Anonymous intake supported.",
  },
  {
    key: "inspections",
    label: "Inspections",
    copy: "Inspection log ships in Wave 1 (W13). Citations link to corrective-action obligations.",
  },
];

export function AuditReadinessContent({ facilityNumber, onBack }: Props) {
  const [tab, setTab] = useState<string>("overview");

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Audit Readiness
        </h1>
      </div>

      <div className="portal-tabs">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full overflow-x-auto">
            <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
            {PLACEHOLDER_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="flex-1">
                {t.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="settings" className="flex-1" aria-label="Reg Settings">
              <Settings className="h-3.5 w-3.5" />
            </TabsTrigger>
          </TabsList>

          {/* Overview — Wave 1 placeholder per Phase 3 §4.7 */}
          <TabsContent value="overview" className="mt-4">
            <div className="rounded-lg border border-dashed p-6">
              <ShieldCheck className="h-7 w-7 mx-auto text-muted-foreground mb-3" />
              <h2 className="text-base font-medium text-center mb-2">
                Welcome to Audit Readiness
              </h2>
              <p className="text-sm text-muted-foreground text-center max-w-xl mx-auto">
                Use this hub to keep your inspection binder healthy day to day.
                In Wave 1 you'll be able to record drills, log temperatures,
                track vendor COIs, intake and close complaints, and record
                inspection visits — all with evidence attachments and history.
              </p>
              <p className="text-sm text-muted-foreground text-center mt-3">
                Today: open <span className="font-medium">Reg Settings (⚙)</span>{" "}
                to review and validate the regulatory values that drive alerts.
              </p>
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setTab("settings")}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Open Reg Settings ⚙
                </button>
              </div>
            </div>
          </TabsContent>

          {/* Wave 1 placeholders */}
          {PLACEHOLDER_TABS.map((t) => (
            <TabsContent key={t.key} value={t.key} className="mt-4">
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {t.copy}
                </p>
              </div>
            </TabsContent>
          ))}

          {/* Reg Settings — Wave 0 A11 */}
          <TabsContent value="settings" className="mt-4">
            <RegSettingsContent facilityNumber={facilityNumber} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
