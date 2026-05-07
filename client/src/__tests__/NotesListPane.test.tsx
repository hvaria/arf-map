/**
 * Stale-selection clearing tests for NotesListPane.
 *
 * Validates the High-2 fix: the "clear selection if not in list" effect must
 * be gated on `!isFetching && isFetched` so an in-flight refetch resolving
 * with stale items can't drop a just-clicked selection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock react-query so we can drive isFetching / isFetched state directly. ─

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQuery: vi.fn(),
    useQueryClient: vi.fn(() => ({
      prefetchQuery: vi.fn(),
      invalidateQueries: vi.fn(),
    })),
  };
});

// Avoid the residents fetch altogether — it's not part of what we test here.
vi.mock("@/hooks/useResidents", () => ({
  useResidents: () => ({ residents: [], all: [] }),
}));

import { useQuery } from "@tanstack/react-query";
import { NotesListPane } from "../components/notes/NotesListPane";
import type { NoteListItem, ListResponse } from "../components/notes/shared";

function makeNote(id: number): NoteListItem {
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
  };
}

function makeListResponse(ids: number[]): ListResponse {
  return {
    success: true,
    data: { items: ids.map(makeNote), nextCursor: null },
  };
}

interface QueryShape {
  data: ListResponse | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  error: Error | null;
}

function setQueryShape(s: Partial<QueryShape>) {
  const full: QueryShape = {
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    error: null,
    ...s,
  };
  vi.mocked(useQuery).mockReturnValue(full as unknown as ReturnType<typeof useQuery>);
}

function renderPane(props: Partial<React.ComponentProps<typeof NotesListPane>> = {}) {
  const onSelect = vi.fn();
  const onClearSelection = vi.fn();
  const onClearSearch = vi.fn();
  const baseProps: React.ComponentProps<typeof NotesListPane> = {
    facilityNumber: "F1",
    group: "all",
    q: "",
    archived: 0,
    selectedNoteId: null,
    onSelect,
    onClearSelection,
    onClearSearch,
    ...props,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NotesListPane {...baseProps} />
    </QueryClientProvider>,
  );
  return { ...utils, onSelect, onClearSelection, onClearSearch };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NotesListPane — stale selection clearing (High 2 fix)", () => {
  it("does NOT call onClearSelection when the selected note is present in the list", async () => {
    setQueryShape({
      data: makeListResponse([1, 5, 7]),
      isFetching: false,
      isFetched: true,
    });

    const { onClearSelection } = renderPane({ selectedNoteId: 5 });

    // Wait a tick to let any effects flush.
    await waitFor(() => {
      // The list rendered.
      expect(useQuery).toHaveBeenCalled();
    });

    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("DOES call onClearSelection when the selected note is missing AND the query is settled", async () => {
    setQueryShape({
      data: makeListResponse([1, 2, 3]),
      isFetching: false,
      isFetched: true,
    });

    const { onClearSelection } = renderPane({ selectedNoteId: 99 });

    await waitFor(() => {
      expect(onClearSelection).toHaveBeenCalledTimes(1);
    });
  });

  it("does NOT call onClearSelection while the query is still fetching (gate works)", async () => {
    // Items DO NOT contain id 99, but isFetching=true so the gate blocks the clear.
    setQueryShape({
      data: makeListResponse([1, 2, 3]),
      isFetching: true,
      isFetched: false,
    });

    const { onClearSelection } = renderPane({ selectedNoteId: 99 });

    // Give the effect a chance to run.
    await new Promise((r) => setTimeout(r, 50));

    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("does NOT call onClearSelection when isFetched is true but isFetching is true (background refetch)", async () => {
    // Stale data is on screen, but a background refetch is running. The gate
    // requires BOTH !isFetching && isFetched, so this should be blocked.
    setQueryShape({
      data: makeListResponse([1, 2, 3]),
      isFetching: true,
      isFetched: true,
    });

    const { onClearSelection } = renderPane({ selectedNoteId: 99 });

    await new Promise((r) => setTimeout(r, 50));

    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("does NOT call onClearSelection when selectedNoteId is null", async () => {
    setQueryShape({
      data: makeListResponse([1, 2, 3]),
      isFetching: false,
      isFetched: true,
    });

    const { onClearSelection } = renderPane({ selectedNoteId: null });

    await new Promise((r) => setTimeout(r, 50));

    expect(onClearSelection).not.toHaveBeenCalled();
  });
});
