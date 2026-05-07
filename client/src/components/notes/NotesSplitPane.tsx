/**
 * NotesSplitPane — responsive layout shell for the dedicated Notes page.
 *
 * Modes (derived from window.innerWidth via a resize listener):
 *   - "split"   (>=1024px): list + detail side-by-side, draggable splitter.
 *   - "stacked" (768-1023px): list (50vh) above detail, no splitter.
 *   - "mobile"  (<768px): list OR detail (driven by `noteId`), not both.
 *
 * Pane width is persisted in `localStorage["notes.paneWidth"]` clamped
 * to [280, 640]. Drag writes are debounced 200ms.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type PaneMode = "split" | "stacked" | "mobile";

const PANE_WIDTH_KEY = "notes.paneWidth";
const PANE_WIDTH_MIN = 280;
const PANE_WIDTH_MAX = 640;
const PANE_WIDTH_DEFAULT = 400;
const DRAG_PERSIST_DEBOUNCE_MS = 200;

export interface NotesSplitPaneProps {
  list: ReactNode;
  detail: ReactNode;
  /** When true on mobile, render the detail (push-to-detail). */
  showDetailOnMobile: boolean;
}

function readPersistedWidth(): number {
  if (typeof window === "undefined") return PANE_WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(PANE_WIDTH_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PANE_WIDTH_DEFAULT;
  return Math.min(PANE_WIDTH_MAX, Math.max(PANE_WIDTH_MIN, n));
}

function deriveMode(): PaneMode {
  if (typeof window === "undefined") return "split";
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "stacked";
  return "split";
}

export function NotesSplitPane({
  list,
  detail,
  showDetailOnMobile,
}: NotesSplitPaneProps) {
  const [mode, setMode] = useState<PaneMode>(() => deriveMode());

  useEffect(() => {
    const onResize = () => setMode(deriveMode());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Pane width state (split mode only) ────────────────────────────────
  const [paneWidth, setPaneWidth] = useState<number>(() => readPersistedWidth());
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((w: number) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      window.localStorage.setItem(PANE_WIDTH_KEY, String(w));
    }, DRAG_PERSIST_DEBOUNCE_MS);
  }, []);

  // ── Drag handle ───────────────────────────────────────────────────────
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const next = Math.min(
        PANE_WIDTH_MAX,
        Math.max(PANE_WIDTH_MIN, e.clientX - rect.left),
      );
      setPaneWidth(next);
      persist(next);
    },
    [persist],
  );

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  const beginDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Keyboard: Left/Right arrows on the splitter resize by 16px.
  const onSplitterKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -16 : 16;
      const next = Math.min(
        PANE_WIDTH_MAX,
        Math.max(PANE_WIDTH_MIN, paneWidth + delta),
      );
      setPaneWidth(next);
      persist(next);
    }
  };

  // Cleanup on unmount.
  useLayoutEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // ── Mobile: render list OR detail, never both ─────────────────────────
  if (mode === "mobile") {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-card border-t border-border">
        {showDetailOnMobile ? detail : list}
      </div>
    );
  }

  // ── Tablet: stacked (list above detail) ───────────────────────────────
  if (mode === "stacked") {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="flex flex-col bg-card border-t border-border"
          style={{ height: "50vh" }}
        >
          {list}
        </div>
        <div className="flex-1 min-h-0 bg-card border-t border-border">
          {detail}
        </div>
      </div>
    );
  }

  // ── Desktop split ─────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 flex border-t border-border"
    >
      <div
        className="flex flex-col bg-card border-r border-border min-h-0"
        style={{ width: `${paneWidth}px`, flexShrink: 0 }}
      >
        {list}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize list pane"
        aria-valuenow={paneWidth}
        aria-valuemin={PANE_WIDTH_MIN}
        aria-valuemax={PANE_WIDTH_MAX}
        tabIndex={0}
        data-testid="notes-splitter"
        onPointerDown={beginDrag}
        onKeyDown={onSplitterKeyDown}
        className={cn(
          "w-1 cursor-col-resize bg-border hover:bg-indigo-300 active:bg-indigo-400",
          "focus:outline-none focus-visible:bg-indigo-400",
          "transition-colors shrink-0",
        )}
      />
      <div className="flex-1 min-w-0 bg-card">{detail}</div>
    </div>
  );
}
