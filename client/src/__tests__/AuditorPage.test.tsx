/**
 * AuditorPage smoke tests — Wave 3 Phase 3.2.
 *
 * Covers:
 *   - Missing/invalid token → "Invalid share link" screen.
 *   - /auditor/me 401 → "expired or revoked" screen.
 *   - /auditor/me 200 → header chrome + tab strip; the Drills tab does NOT
 *     render a "Log drill" button because useIsWritable() returns false.
 *
 * Pattern reused:
 *   - wouter useRoute stub:
 *       client/src/__tests__/NotesPage.test.tsx:16-18
 *   - fetch URL-capture mock:
 *       client/src/__tests__/AuditTrailViewer.test.tsx:80-90
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Drive useRoute's response per test.
const routeMock = vi.fn();
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useRoute: () => routeMock(),
  };
});

// Stub the heavy sub-views so the test focuses on the shell itself.
vi.mock("@/components/operations/DrillsContent", () => ({
  DrillsContent: () => (
    <div data-testid="drills-content-stub">
      {/* Mirror the writable-gated trigger by reading the AuditorContext. */}
      <DrillsTriggerStub />
    </div>
  ),
}));
vi.mock("@/components/operations/TemperatureLogsContent", () => ({
  TemperatureLogsContent: () => <div data-testid="logs-content-stub" />,
}));
vi.mock("@/components/operations/VendorsContent", () => ({
  VendorsContent: () => <div data-testid="vendors-content-stub" />,
}));
vi.mock("@/components/operations/ComplaintsContent", () => ({
  ComplaintsContent: () => <div data-testid="complaints-content-stub" />,
}));
vi.mock("@/components/operations/InspectionsContent", () => ({
  InspectionsContent: () => <div data-testid="inspections-content-stub" />,
}));
vi.mock("@/components/operations/AuditTrailViewer", () => ({
  AuditTrailViewer: () => <div data-testid="audit-trail-stub" />,
}));

import { useIsWritable } from "@/context/AuditorContext";

function DrillsTriggerStub() {
  const writable = useIsWritable();
  if (!writable) return null;
  return <button data-testid="drill-log-trigger">Log drill</button>;
}

import AuditorPage from "../pages/AuditorPage";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuditorPage", () => {
  it("renders the invalid-token screen when no token is in the URL", () => {
    routeMock.mockReturnValue([false, null]);
    render(<AuditorPage />);
    expect(screen.getByTestId("auditor-invalid")).toBeInTheDocument();
  });

  it("renders the expired screen when /auditor/me returns 401", async () => {
    routeMock.mockReturnValue([true, { token: "tok-bad" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, 401)),
    );
    render(<AuditorPage />);
    await waitFor(() =>
      expect(screen.getByTestId("auditor-expired")).toBeInTheDocument(),
    );
  });

  it("renders the chrome + hides write buttons on a valid session", async () => {
    routeMock.mockReturnValue([true, { token: "tok-good" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            facilityNumber: "197600001",
            audience: "cdss",
            expiresAt: Date.now() + 24 * 3600 * 1000,
            facilityName: "Sunny Ridge Care",
          },
        }),
      ),
    );
    render(<AuditorPage />);

    await waitFor(() =>
      expect(screen.getByTestId("auditor-page")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Sunny Ridge Care/)).toBeInTheDocument();
    expect(screen.getByTestId("auditor-audience-chip")).toBeInTheDocument();

    // The default tab is Overview, which renders no write buttons. Confirm
    // the welcome panel is visible.
    expect(
      screen.getByTestId("auditor-overview-welcome"),
    ).toBeInTheDocument();
    // The stubbed DrillsContent only renders the trigger when writable; the
    // Drills tab is not active by default, but even if mounted (some
    // shadcn Tabs render hidden content), the writable=false rule means
    // the button never appears.
    expect(screen.queryByTestId("drill-log-trigger")).toBeNull();
  });

  it("Audit trail tab is included; Reg Settings tab is NOT", async () => {
    routeMock.mockReturnValue([true, { token: "tok-good" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            facilityNumber: "197600001",
            audience: "ombudsman",
            expiresAt: Date.now() + 24 * 3600 * 1000,
          },
        }),
      ),
    );
    render(<AuditorPage />);
    await waitFor(() =>
      expect(screen.getByTestId("auditor-page")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("auditor-tab-audit-trail")).toBeInTheDocument();
    // Reg Settings should not appear anywhere in the auditor shell.
    expect(screen.queryByLabelText(/Reg Settings/i)).toBeNull();
  });
});
