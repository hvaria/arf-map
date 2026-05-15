/**
 * <PostingsContent> smoke tests — Wave 4 W6.
 *
 * Covers:
 *   - Empty state surfaces the "Seed default postings" CTA and POSTs to
 *     /api/ops/facilities/:fn/postings/seed.
 *   - Each row renders the freshness chip (current/stale/missing).
 *   - Clicking Verify opens the dialog and POSTs to
 *     /api/ops/postings/:id/verify on save.
 *
 * Patterns reused:
 *   - QueryClient + wrapper helpers:         VendorsContent.test.tsx:49-62
 *   - vi.stubGlobal("fetch", …) JSON mock:   VendorsContent.test.tsx:96-99
 *   - apiRequest mock pattern:               VendorsContent.test.tsx:26-31
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
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
  PostingsContent,
  type PostingRow,
} from "../components/operations/PostingsContent";

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

function row(overrides: Partial<PostingRow> = {}): PostingRow {
  return {
    id: 1,
    facilityNumber: "197600001",
    postingKey: "residents_rights",
    titleEn: "Residents' rights",
    titleEs: "Derechos de los residentes",
    locationHint: "Common area",
    required: 1,
    cadenceDays: 30,
    status: "active",
    latestVerification: {
      id: 11,
      verifiedAt: Date.now() - 12 * 24 * 60 * 60 * 1000,
      verifiedBy: "Maria S.",
      status: "current",
      note: null,
      evidenceCount: 2,
    },
    freshness: "ok",
    placeholder: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PostingsContent — empty state", () => {
  it("shows the Seed default postings CTA and POSTs the seed endpoint", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { created: 14, skipped: 0 } }),
    );

    render(<PostingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("posting-empty")).toBeInTheDocument();
    const cta = screen.getByTestId("posting-seed-trigger");
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/facilities/197600001/postings/seed",
      );
    });
  });
});

describe("PostingsContent — list freshness chips", () => {
  it("renders an ok / stale / missing chip per row", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            row({ id: 1, freshness: "ok", titleEn: "Residents' rights" }),
            row({
              id: 2,
              freshness: "stale",
              titleEn: "Evacuation route map",
              titleEs: null,
              latestVerification: {
                id: 22,
                verifiedAt: Date.now() - 47 * 24 * 60 * 60 * 1000,
                verifiedBy: "Anil P.",
                status: "current",
                note: null,
                evidenceCount: 0,
              },
            }),
            row({
              id: 3,
              freshness: "missing",
              titleEn: "Abuse reporting hotline",
              latestVerification: null,
            }),
          ],
        }),
      ),
    );

    render(<PostingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("posting-list")).toBeInTheDocument();
    const chip1 = await screen.findByTestId("posting-row-chip-1");
    const chip2 = await screen.findByTestId("posting-row-chip-2");
    const chip3 = await screen.findByTestId("posting-row-chip-3");
    expect(chip1.textContent).toMatch(/Current/);
    expect(chip2.textContent).toMatch(/Stale/);
    expect(chip3.textContent).toMatch(/Missing/);
  });
});

describe("PostingsContent — verify flow", () => {
  it("opens the verify dialog and POSTs /api/ops/postings/:id/verify", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: true, data: [row({ id: 7 })] }),
        ),
    );
    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { id: 99, verifiedAt: Date.now() },
      }),
    );

    render(<PostingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    fireEvent.click(await screen.findByTestId("posting-verify-trigger-7"));
    await screen.findByTestId("posting-verify-status");
    fireEvent.click(screen.getByTestId("posting-verify-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/postings/7/verify",
        expect.objectContaining({ status: "current" }),
      );
    });
  });
});
