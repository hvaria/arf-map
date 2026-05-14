/**
 * Incident Lifecycle (W4) smoke tests — Wave 2.
 *
 * Covers:
 *   - Checklist panel renders all 9 items with right done/pending states.
 *   - "Close incident" disabled when canClose=false, enabled when true.
 *   - Close modal: <8-char closureNote shows inline error; >=8 submits POST.
 *   - Reopen button only visible when status='closed'; modal submits POST.
 *   - Closed/reopened metadata banners render.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Test layout / mocks:           ComplaintsContent.test.tsx
 *   - QueryClient/wrapper helpers:   ComplaintsContent.test.tsx:49-62
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: vi.fn() };
});

import { apiRequest } from "@/lib/queryClient";
import {
  IncidentChecklistPanel,
  type IncidentChecklistData,
} from "../components/operations/IncidentsContent";

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function freshClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

type ChecklistKey = keyof IncidentChecklistData["required"];

const ALL_KEYS: ChecklistKey[] = [
  "supervisor",
  "family",
  "physician",
  "ccldVerbal",
  "lic624",
  "soc341",
  "rootCause",
  "correctiveAction",
  "followUp",
];

function checklist(
  overrides: Partial<IncidentChecklistData> = {},
): IncidentChecklistData {
  const required = ALL_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: true }),
    {} as IncidentChecklistData["required"],
  );
  const done = ALL_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: false }),
    {} as IncidentChecklistData["done"],
  );
  return {
    incidentId: 1,
    status: "under_review",
    eventSeverity: "serious",
    required,
    done,
    sla: {},
    canClose: false,
    blockingReasons: ["Supervisor not notified", "LIC 624 not submitted"],
    ...overrides,
  };
}

interface IncidentRowLite {
  id: number;
  status: string;
  eventSeverity?: "serious" | "non_emergent" | null;
  supervisorNotifiedAt: number | null;
  familyNotifiedAt: number | null;
  physicianNotifiedAt: number | null;
  ccldVerbalNotifiedAt?: number | null;
  ccldVerbalNotifiedBy?: string | null;
  lic624SubmittedAt?: number | null;
  soc341SubmittedAt?: number | null;
  followUpDate?: number | null;
  closureNote?: string | null;
  closedAt?: number | null;
  closedBy?: string | null;
  reopenedAt?: number | null;
  reopenedBy?: string | null;
  reopenReason?: string | null;
}

function incidentRow(overrides: Partial<IncidentRowLite> = {}): IncidentRowLite {
  return {
    id: 1,
    status: "under_review",
    eventSeverity: "serious",
    supervisorNotifiedAt: null,
    familyNotifiedAt: null,
    physicianNotifiedAt: null,
    ...overrides,
  };
}

function mountChecklist(opts: {
  qc: QueryClient;
  checklistData: IncidentChecklistData;
  incident?: IncidentRowLite;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: opts.checklistData }),
    ),
  );
  // The panel needs an `incident` shape (subset of Incident). The test
  // fixture is a structural subset; cast through `unknown` to satisfy
  // the panel's typed prop.
  const incident = opts.incident ?? incidentRow();
  const PanelAny = IncidentChecklistPanel as unknown as (props: {
    incident: IncidentRowLite;
    facilityNumber: string;
    rootCauseDraft: string;
    correctiveActionDraft: string;
  }) => JSX.Element;
  return render(
    <PanelAny
      incident={incident}
      facilityNumber="197600001"
      rootCauseDraft=""
      correctiveActionDraft=""
    />,
    { wrapper: wrapper(opts.qc) },
  );
}

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// Render — all 9 items + done/pending states
// ─────────────────────────────────────────────────────────────────────────────

describe("Incident checklist — render", () => {
  it("renders all 9 checklist items with right done/pending states", async () => {
    const data = checklist({
      done: {
        supervisor: true,
        family: true,
        physician: false,
        ccldVerbal: false,
        lic624: false,
        soc341: false,
        rootCause: false,
        correctiveAction: false,
        followUp: false,
      },
    });

    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: data,
      incident: incidentRow({
        supervisorNotifiedAt: Date.now() - 60_000,
        familyNotifiedAt: Date.now() - 30_000,
      }),
    });

    expect(await screen.findByTestId("incident-checklist-panel")).toBeInTheDocument();

    // All 9 items render
    for (const k of ALL_KEYS) {
      expect(screen.getByTestId(`incident-checklist-${k}`)).toBeInTheDocument();
    }

    // Done rows
    expect(
      screen.getByTestId("incident-checklist-supervisor").getAttribute("data-done"),
    ).toBe("true");
    expect(
      screen.getByTestId("incident-checklist-family").getAttribute("data-done"),
    ).toBe("true");
    // Pending rows
    expect(
      screen.getByTestId("incident-checklist-physician").getAttribute("data-done"),
    ).toBe("false");
    expect(
      screen.getByTestId("incident-checklist-lic624").getAttribute("data-done"),
    ).toBe("false");

    // Severity badge
    expect(screen.getByTestId("incident-severity-badge").textContent).toMatch(/serious/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Close button gating
// ─────────────────────────────────────────────────────────────────────────────

describe("Incident close button — gating", () => {
  it("is disabled and shows blocking reasons when canClose=false", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({
        canClose: false,
        blockingReasons: ["Supervisor not notified", "LIC 624 not submitted"],
      }),
    });

    const trigger = await screen.findByTestId("incident-close-trigger");
    expect((trigger as HTMLButtonElement).disabled).toBe(true);

    const reasons = screen.getByTestId("incident-blocking-reasons");
    expect(reasons.textContent).toMatch(/Supervisor not notified/);
    expect(reasons.textContent).toMatch(/LIC 624 not submitted/);
  });

  it("is enabled when canClose=true", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({ canClose: true, blockingReasons: [] }),
    });
    const trigger = await screen.findByTestId("incident-close-trigger");
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("incident-blocking-reasons")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Close modal — closureNote validation + POST
// ─────────────────────────────────────────────────────────────────────────────

describe("Close incident modal — closure note validation", () => {
  it("shows inline error when closureNote < 8 chars and does not POST", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({ canClose: true, blockingReasons: [] }),
    });

    fireEvent.click(await screen.findByTestId("incident-close-trigger"));
    fireEvent.change(await screen.findByTestId("incident-close-note"), {
      target: { value: "short" }, // 5 chars < 8
    });
    fireEvent.click(screen.getByTestId("incident-close-submit"));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("submits POST when closureNote >= 8 chars", async () => {
    mockApi.mockResolvedValue(jsonResponse({ success: true, data: { id: 1 } }));
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({ canClose: true, blockingReasons: [] }),
    });

    fireEvent.click(await screen.findByTestId("incident-close-trigger"));
    fireEvent.change(await screen.findByTestId("incident-close-note"), {
      target: { value: "All steps complete — closing per W4 SLA." },
    });
    fireEvent.click(screen.getByTestId("incident-close-submit"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/incidents/1/close",
        expect.objectContaining({
          closureNote: "All steps complete — closing per W4 SLA.",
        }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reopen — visibility + POST
// ─────────────────────────────────────────────────────────────────────────────

describe("Reopen incident — visibility + submit", () => {
  it("is hidden when status != 'closed'", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({ status: "under_review", canClose: true }),
    });
    await screen.findByTestId("incident-checklist-panel");
    expect(screen.queryByTestId("incident-reopen-trigger")).toBeNull();
    // Close button is shown instead
    expect(screen.getByTestId("incident-close-trigger")).toBeInTheDocument();
  });

  it("is visible when status='closed' and submits POST with reason", async () => {
    mockApi.mockResolvedValue(jsonResponse({ success: true, data: { id: 1 } }));
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({
        status: "closed",
        canClose: true,
        blockingReasons: [],
      }),
      incident: incidentRow({
        status: "closed",
        closedAt: Date.now() - 60_000,
        closedBy: "Himanshu T.",
        closureNote: "Resolution summary.",
      }),
    });

    const trigger = await screen.findByTestId("incident-reopen-trigger");
    expect(trigger).toBeInTheDocument();
    // Close button should not be visible
    expect(screen.queryByTestId("incident-close-trigger")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.change(await screen.findByTestId("incident-reopen-reason"), {
      target: { value: "New evidence surfaced — corrective action incomplete." },
    });
    fireEvent.click(screen.getByTestId("incident-reopen-submit"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/incidents/1/reopen",
        expect.objectContaining({
          reason: "New evidence surfaced — corrective action incomplete.",
        }),
      );
    });
  });

  it("blocks reopen POST when reason < 8 chars", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({
        status: "closed",
        canClose: true,
        blockingReasons: [],
      }),
      incident: incidentRow({
        status: "closed",
        closedAt: Date.now() - 60_000,
        closedBy: "Himanshu T.",
      }),
    });

    fireEvent.click(await screen.findByTestId("incident-reopen-trigger"));
    fireEvent.change(await screen.findByTestId("incident-reopen-reason"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByTestId("incident-reopen-submit"));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockApi).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Closed / Reopened metadata banners
// ─────────────────────────────────────────────────────────────────────────────

describe("Closed/reopened metadata banners", () => {
  it("renders the closed banner with closedBy + closureNote", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({ status: "closed", canClose: true }),
      incident: incidentRow({
        status: "closed",
        closedAt: Date.now() - 60_000,
        closedBy: "Himanshu T.",
        closureNote: "All steps completed; archived.",
      }),
    });

    const banner = await screen.findByTestId("incident-closed-banner");
    expect(banner.textContent).toMatch(/Closed by Himanshu T\./);
    expect(within(banner).getByText(/All steps completed; archived\./)).toBeInTheDocument();
  });

  it("renders the reopened banner when reopenedAt present + status under_review", async () => {
    const qc = freshClient();
    mountChecklist({
      qc,
      checklistData: checklist({ status: "under_review" }),
      incident: incidentRow({
        status: "under_review",
        reopenedAt: Date.now() - 60_000,
        reopenedBy: "Maria S.",
        reopenReason: "Additional evidence located.",
      }),
    });

    const banner = await screen.findByTestId("incident-reopened-banner");
    expect(banner.textContent).toMatch(/Reopened by Maria S\./);
    expect(within(banner).getByText(/Additional evidence located\./)).toBeInTheDocument();
  });
});
