/**
 * NoteDetailPane tests.
 *
 * Covers:
 *   - Ack optimism does NOT leak when noteId switches (Blocker 2 fix:
 *     `useEffect([noteId])` resets `optimisticAcked`).
 *   - Empty state renders when noteId is null.
 *   - ReplyBox invalidation is single-target (High 1 fix): posting a reply
 *     invalidates ONLY the parent note's detail query, NOT the list query.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock apiRequest so mutations resolve without a network round-trip.
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queryClient")>();
  return {
    ...original,
    apiRequest: vi.fn(),
    getQueryFn: vi.fn(({ on401 }: { on401: string }) =>
      // Default: return a successful detail envelope. Tests override per-key
      // via setDetailMap below.
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = String(queryKey[0]);
        const handler = detailMap.get(url);
        if (handler) return handler();
        return null;
      },
    ),
  };
});

// Stub useToast — we don't need real toast rendering.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { apiRequest } from "@/lib/queryClient";
import { NoteDetailPane } from "../components/notes/NoteDetailPane";
import { ReplyBox } from "../components/notes/composer/ReplyBox";
import type {
  DetailResponse,
  NoteDetail,
  NoteListItem,
} from "../components/notes/shared";

// ─── Per-test detail responder ───────────────────────────────────────────────
const detailMap = new Map<string, () => unknown>();

function makeNote(id: number, overrides: Partial<NoteListItem> = {}): NoteListItem {
  return {
    id,
    facilityNumber: "F1",
    parentNoteId: null,
    category: "general",
    residentId: null,
    title: `Note ${id}`,
    body: `Body ${id}`,
    visibilityScope: "facility_wide",
    priority: "normal",
    status: "open",
    ackRequired: 0,
    authorFacilityAccountId: 1,
    authorDisplayName: "Test Author",
    authorRole: "staff",
    archivedAt: null,
    deletedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    editCount: 0,
    tags: [],
    ...overrides,
  };
}

function makeDetail(id: number, overrides: Partial<NoteDetail> = {}): DetailResponse {
  return {
    success: true,
    data: {
      note: makeNote(id),
      tags: [],
      attachments: [],
      mentions: [],
      acknowledgments: [],
      replies: [],
      versions: [],
      ...overrides,
    },
  };
}

function renderWith(children: React.ReactNode, queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });
  const utils = render(
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  );
  return { ...utils, queryClient: qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  detailMap.clear();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NoteDetailPane — empty state", () => {
  it("renders the 'Select a note to read' empty state when noteId is null", async () => {
    renderWith(<NoteDetailPane noteId={null} />);
    await waitFor(() => {
      expect(screen.getByTestId("notes-empty-no-selection")).toBeInTheDocument();
    });
  });
});

describe("NoteDetailPane — ack optimism reset (Blocker 2 fix)", () => {
  it("resets optimisticAcked when noteId switches to a different note", async () => {
    detailMap.set("/api/ops/notes/1", () => makeDetail(1));
    detailMap.set("/api/ops/notes/2", () => makeDetail(2));
    // Ack POST resolves successfully.
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({ ok: true }),
    } as unknown as Response);

    const { rerender, queryClient } = renderWith(<NoteDetailPane noteId={1} />);

    // Wait for detail to render and the Ack button to appear.
    const ackBtn = await screen.findByRole("button", { name: /^Ack$/i });

    // Click Ack → optimistic state flips to "Acked" and the button disables.
    await userEvent.click(ackBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Acked/i }),
      ).toBeInTheDocument();
    });

    // Now switch to note 2. Without the fix, optimisticAcked from note 1
    // would still be true and the Ack button would render as "Acked".
    rerender(
      <QueryClientProvider client={queryClient}>
        <NoteDetailPane noteId={2} />
      </QueryClientProvider>,
    );

    // Wait for the detail of note 2 to render. The Ack button should read
    // "Ack" (not "Acked"), proving the optimistic flag was reset.
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /^Ack$/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    // Sanity: there should be no "Acked" button visible.
    expect(screen.queryByRole("button", { name: /Acked/i })).not.toBeInTheDocument();
  });
});

describe("ReplyBox — single-target invalidation (High 1 fix)", () => {
  it("invalidates ONLY the parent note's detail query on reply success — not the list query", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    // Reply POST succeeds.
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({ ok: true }),
    } as unknown as Response);

    renderWith(<ReplyBox parentNoteId={42} />, qc);

    // Type something and click Send.
    const textarea = screen.getByPlaceholderText(/Reply…/i);
    await userEvent.type(textarea, "Hello world");
    const sendBtn = screen.getByRole("button", { name: /Send/i });
    await userEvent.click(sendBtn);

    // Wait for the mutation to resolve and invalidation to fire.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalled();
    });

    // Inspect every invalidate call — none should be a list-shape predicate
    // and none should target a list URL. The only allowed key is the parent
    // detail query.
    const calls = invalidateSpy.mock.calls;
    for (const [arg] of calls) {
      // High 1 invariant: no `predicate:` form (broad invalidation), and
      // no list URLs in the queryKey.
      expect((arg as { predicate?: unknown }).predicate).toBeUndefined();
      const key = (arg as { queryKey?: readonly unknown[] }).queryKey;
      expect(Array.isArray(key)).toBe(true);
      // The single key should target the parent detail.
      expect(key).toEqual([`/api/ops/notes/42`]);
      // It must NOT match a list-shaped key.
      const k0 = String(key?.[0] ?? "");
      expect(k0.includes("?status=")).toBe(false);
      expect(k0.includes("limit=")).toBe(false);
    }

    // And there should be exactly ONE invalidation call.
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
