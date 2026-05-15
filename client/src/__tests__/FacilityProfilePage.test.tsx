/**
 * <FacilityDetailsTab> smoke tests — sectioned profile page.
 *
 * Acceptance per the spec:
 *   - Renders all 8 sections.
 *   - Logo upload: 3 MB image rejected client-side; 1 MB PNG accepted and POSTs.
 *   - Languages multi-select toggles.
 *   - Care types multi-select toggles.
 *   - "Refresh from CCLD" button POSTs the prefill endpoint and toasts.
 *   - CCLD physical address read-only; "Copy to mailing" populates mailing fields.
 *
 * Mock surfaces:
 *   - `fetch` → for GET /api/facility/profile (getQueryFn) and the multipart
 *     POST to /api/facility/profile/logo (raw fetch).
 *   - `apiRequest` → for PUT /api/facility/profile and POST .../prefill-from-ccld.
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
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

import { apiRequest } from "@/lib/queryClient";
import { FacilityDetailsTab } from "../components/facility/FacilityDetailsTab";

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;

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

const baseEnvelope = {
  overrides: {
    phone: "(555) 555-5555",
    email: "ops@example.com",
    website: null,
    description: "A welcoming home.",
    dbaName: null,
    yearEstablished: 2010,
    languages: ["en"],
    careTypes: ["assisted_living"],
    accreditations: [],
    mailingAddressLine1: null,
    mailingCity: null,
    mailingState: null,
    mailingZip: null,
    administratorName: "Jane Smith",
    logoStorageUri: null,
    logoUpdatedAt: null,
  },
  ccld: {
    phone: "(555) 000-0000",
    address: "123 Main St",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
    administrator: "Jane Smith",
    capacity: 42,
    firstLicenseDate: "2001-01-01",
  },
};

beforeEach(() => {
  toastMock.mockReset();
  mockApi.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FacilityDetailsTab — sections render", () => {
  it("renders all 8 sections with expected headings", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    // The envelope GET fires once.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // All eight sections present (by visible heading).
    for (const heading of [
      "Identity & branding",
      "Contact & basics",
      "Address",
      "Hours & languages",
      "Care offered",
      "Administrator",
      "Social",
      "Report letterhead",
    ]) {
      expect(
        await screen.findByText(heading),
      ).toBeInTheDocument();
    }
  });
});

describe("FacilityDetailsTab — CCLD address read-only + copy", () => {
  it("renders the CCLD physical address read-only and populates mailing fields on copy", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    // CCLD physical address displayed in the Address section read-only block.
    const physical = await screen.findByTestId("ccld-physical-address");
    expect(physical.textContent).toMatch(/123 Main St/);
    expect(physical.textContent).toMatch(/Sacramento/);

    // Open the Address edit dialog.
    fireEvent.click(screen.getByTestId("section-address-edit"));

    // The copy-to-mailing button populates the mailing fields with the CCLD
    // address parts.
    const copyBtn = await screen.findByTestId("copy-to-mailing-btn");
    fireEvent.click(copyBtn);

    const line1 = screen.getByTestId(
      "mailing-line1-input",
    ) as HTMLInputElement;
    const city = screen.getByTestId(
      "mailing-city-input",
    ) as HTMLInputElement;
    expect(line1.value).toBe("123 Main St");
    expect(city.value).toBe("Sacramento");
  });
});

describe("FacilityDetailsTab — Languages multi-select", () => {
  it("toggles a language chip on click", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    // Open the Hours & languages dialog.
    fireEvent.click(await screen.findByTestId("section-hours-edit"));

    // Spanish chip starts inactive (only "en" is on the override).
    const spanish = await screen.findByTestId("lang-chip-es");
    expect(spanish.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(spanish);
    expect(spanish.getAttribute("aria-pressed")).toBe("true");

    // English starts active; toggle off.
    const english = screen.getByTestId("lang-chip-en");
    expect(english.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(english);
    expect(english.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("FacilityDetailsTab — Care types multi-select", () => {
  it("toggles a care-type chip on click", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.click(await screen.findByTestId("section-care-edit"));

    // Memory care starts inactive.
    const memory = await screen.findByTestId("care-chip-memory_care");
    expect(memory.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(memory);
    expect(memory.getAttribute("aria-pressed")).toBe("true");

    // Assisted living starts active (in baseEnvelope); toggle off.
    const assisted = screen.getByTestId("care-chip-assisted_living");
    expect(assisted.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(assisted);
    expect(assisted.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("FacilityDetailsTab — Refresh from CCLD", () => {
  it("posts to the prefill endpoint and toasts on success", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { fields: ["phone", "mailingCity"] },
      }),
    );

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    const btn = await screen.findByTestId("refresh-from-ccld-btn");
    fireEvent.click(btn);

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(mockApi).toHaveBeenCalledWith(
      "POST",
      "/api/facility/profile/prefill-from-ccld",
    );
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
      const titles = toastMock.mock.calls.map((c) => c[0]?.title);
      expect(titles.some((t: string) => /refreshed 2/i.test(t))).toBe(true);
    });
  });
});

describe("FacilityDetailsTab — Logo upload", () => {
  it("rejects a 3 MB image client-side without POSTing", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    const input = (await screen.findByTestId(
      "logo-upload-input",
    )) as HTMLInputElement;

    // Build a fake 3 MB PNG. The constructor accepts any blob parts —
    // we just need .size to exceed 2 MB.
    const tooBig = new File(
      [new Uint8Array(3 * 1024 * 1024)],
      "huge.png",
      { type: "image/png" },
    );
    Object.defineProperty(input, "files", {
      value: [tooBig],
      configurable: true,
    });
    fireEvent.change(input);

    // The validation toast fires; no upload POST happens.
    await waitFor(() => {
      const titles = toastMock.mock.calls.map((c) => c[0]?.title);
      expect(
        titles.some((t: string) => /couldn't upload logo/i.test(t)),
      ).toBe(true);
    });
    const postCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls.length).toBe(0);
  });

  it("accepts a 1 MB PNG and POSTs multipart to /api/facility/profile/logo", async () => {
    const qc = freshClient();
    // 1st fetch: GET /api/facility/profile  (envelope)
    // 2nd fetch: POST /api/facility/profile/logo (multipart)
    // 3rd fetch: refetch after invalidate
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(baseEnvelope));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    fetchMock.mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    const input = (await screen.findByTestId(
      "logo-upload-input",
    )) as HTMLInputElement;

    const ok = new File(
      [new Uint8Array(1 * 1024 * 1024)],
      "logo.png",
      { type: "image/png" },
    );
    Object.defineProperty(input, "files", {
      value: [ok],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall?.[0]).toBe("/api/facility/profile/logo");
    });
  });
});

describe("FacilityDetailsTab — listing-completeness banner", () => {
  it("shows the missing-fields banner when phone/email/description are absent", async () => {
    const qc = freshClient();
    const envelope = {
      ...baseEnvelope,
      overrides: {
        ...baseEnvelope.overrides,
        phone: null,
        email: null,
        description: null,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
      />,
      { wrapper: wrapper(qc) },
    );

    const banner = await screen.findByTestId(
      "listing-completeness-banner",
    );
    expect(banner.textContent).toMatch(/missing 3 fields/i);
    expect(banner.textContent).toMatch(/phone/);
    expect(banner.textContent).toMatch(/email/);
    expect(banner.textContent).toMatch(/description/);
  });
});

describe("FacilityDetailsTab — prefill banner", () => {
  it("renders the dismissible prefill banner when initialCcldPrefill is provided", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseEnvelope));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FacilityDetailsTab
        facilityNumber="197600001"
        facilityName="Sunshine ARF"
        initialCcldPrefill={{
          fields: ["phone", "administratorName"],
          at: Date.now(),
        }}
      />,
      { wrapper: wrapper(qc) },
    );

    const banner = await screen.findByTestId("ccld-prefill-banner");
    expect(banner.textContent).toMatch(/pre-filled 2 fields/i);

    // Dismiss removes the banner.
    fireEvent.click(within(banner).getByLabelText(/dismiss/i));
    await waitFor(() => {
      expect(
        screen.queryByTestId("ccld-prefill-banner"),
      ).not.toBeInTheDocument();
    });
  });
});
