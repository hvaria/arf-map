/**
 * BristolScale — 7 illustrated cards (1..7) for the Toileting tracker BM
 * event type. Tap to select. SVG illustrations are inline (no image assets).
 *
 * Each card targets a 56 px+ touch surface, scales briefly on tap, and shows
 * a thin colored ring whose color reflects the Bristol category
 * (constipation = amber, normal = emerald, loose = sky/red).
 */
import { cn } from "@/lib/utils";
import {
  BRISTOL_META,
  BRISTOL_TYPES,
  type BristolType,
} from "@shared/tracker-schemas";

const CATEGORY_RING: Record<
  "constipation" | "normal" | "loose",
  { ring: string; bg: string; text: string; selectedRing: string }
> = {
  constipation: {
    ring: "ring-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-800",
    selectedRing: "ring-amber-500",
  },
  normal: {
    ring: "ring-emerald-200",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    selectedRing: "ring-emerald-500",
  },
  loose: {
    ring: "ring-sky-200",
    bg: "bg-sky-50",
    text: "text-sky-800",
    selectedRing: "ring-sky-500",
  },
};

export function BristolScale({
  value,
  onChange,
  error,
}: {
  value: BristolType | undefined;
  onChange: (next: BristolType) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Bristol stool type"
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5"
      >
        {BRISTOL_TYPES.map((type) => {
          const meta = BRISTOL_META[type];
          const cls = CATEGORY_RING[meta.category];
          const selected = value === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Type ${type} — ${meta.title}, ${meta.description}`}
              onClick={() => onChange(type)}
              className={cn(
                "group relative flex flex-col items-center text-left rounded-lg border bg-white p-2.5 min-h-[164px] transition-all",
                "ring-1 ring-inset",
                cls.ring,
                "hover:-translate-y-0.5 hover:shadow-md",
                "active:scale-95",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400",
                selected && "shadow-md -translate-y-0.5",
                selected && cls.selectedRing,
                selected && "ring-2",
              )}
            >
              <div
                className={cn(
                  "w-full h-16 rounded-md flex items-center justify-center mb-2",
                  cls.bg,
                )}
              >
                <BristolGlyph type={type} />
              </div>
              <p className={cn("text-[11px] font-semibold", cls.text)}>
                Type {type}
              </p>
              <p className="text-xs font-medium leading-tight">
                {meta.title}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                {meta.description}
              </p>
              {selected && (
                <span
                  className={cn(
                    "absolute top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-white text-[10px] font-bold animate-in fade-in zoom-in-50",
                    meta.category === "constipation" && "bg-amber-500",
                    meta.category === "normal" && "bg-emerald-500",
                    meta.category === "loose" && "bg-sky-500",
                  )}
                  aria-hidden="true"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Inline SVG glyphs — simple shapes per Bristol type. Color is intentionally
 * neutral (slate) so the category ring around the card carries the meaning.
 */
function BristolGlyph({ type }: { type: BristolType }) {
  const stroke = "#475569";
  const fill = "#94a3b8";
  switch (type) {
    case 1:
      // Hard separate lumps
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          {[10, 26, 42, 58].map((cx, i) => (
            <circle
              key={i}
              cx={cx}
              cy={20}
              r={6}
              fill={fill}
              stroke={stroke}
              strokeWidth="1.5"
            />
          ))}
          <circle cx={70} cy={20} r={6} fill={fill} stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 2:
      // Lumpy sausage
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          <path
            d="M6 22 q6 -10 14 -2 q6 -10 14 -2 q6 -10 14 -2 q6 -10 14 -2 q6 8 -2 14 q-8 6 -16 0 q-8 6 -16 0 q-8 6 -16 0 q-8 -2 -6 -6 z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
          />
        </svg>
      );
    case 3:
      // Sausage with cracks
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          <rect x="6" y="14" width="68" height="14" rx="7" fill={fill} stroke={stroke} strokeWidth="1.5" />
          <line x1="20" y1="14" x2="20" y2="28" stroke={stroke} strokeWidth="1" />
          <line x1="36" y1="14" x2="36" y2="28" stroke={stroke} strokeWidth="1" />
          <line x1="52" y1="14" x2="52" y2="28" stroke={stroke} strokeWidth="1" />
        </svg>
      );
    case 4:
      // Smooth snake
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          <path
            d="M6 20 q15 -14 30 0 q15 14 30 0"
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M6 20 q15 -14 30 0 q15 14 30 0"
            fill="none"
            stroke={fill}
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
      );
    case 5:
      // Soft blobs with edges
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          {[14, 32, 50, 68].map((cx, i) => (
            <ellipse
              key={i}
              cx={cx}
              cy={22}
              rx={8}
              ry={6}
              fill={fill}
              stroke={stroke}
              strokeWidth="1.5"
            />
          ))}
        </svg>
      );
    case 6:
      // Fluffy / mushy
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          <path
            d="M10 28 q4 -10 12 -8 q4 -10 12 -6 q4 -12 14 -6 q4 -10 14 -4 q6 6 0 12 q-30 6 -52 2 z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
          />
          <circle cx={20} cy={16} r={3} fill={fill} stroke={stroke} strokeWidth="1" />
          <circle cx={40} cy={12} r={3} fill={fill} stroke={stroke} strokeWidth="1" />
          <circle cx={60} cy={14} r={3} fill={fill} stroke={stroke} strokeWidth="1" />
        </svg>
      );
    case 7:
      // Watery liquid
      return (
        <svg viewBox="0 0 80 40" className="w-16 h-10" aria-hidden="true">
          <path
            d="M4 30 q10 -6 20 0 t20 0 t20 0 t12 0 v6 H4 z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
          />
          <path
            d="M4 24 q10 -6 20 0 t20 0 t20 0 t12 0"
            fill="none"
            stroke={stroke}
            strokeWidth="1"
          />
        </svg>
      );
  }
}
