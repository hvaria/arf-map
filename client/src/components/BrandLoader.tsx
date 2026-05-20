// BrandLoader — looping data-loading indicator built from the
// neighbourhood brand mark (heart-at-center, 8 dots in a clockwise
// ring). The visual vocabulary matches the marketing-landing reveal
// (AnimatedBrandMark) and the static BrandLogo, but tuned for a
// continuous loop so the app feels coherent every time the user is
// staring at a wait state.
//
// Sizing: sm/md/lg picks a sensible visual weight for inline /
// page-level / full-screen loading states. Override `size` with a
// raw px number if you need something specific.
//
// Reduced-motion users get a static brand mark — same look, no
// flashing dots / breathing heart.
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface BrandLoaderProps {
  /** Visual weight. "sm" inline, "md" panels, "lg" full-screen. */
  size?: "sm" | "md" | "lg" | number;
  /** Optional caption rendered below the mark. */
  label?: string;
  className?: string;
}

const SIZE_PX: Record<"sm" | "md" | "lg", number> = {
  sm: 40,
  md: 80,
  lg: 160,
};

const DOT_COLORS = ["#C25A2E", "#D4693A", "#E8864A", "#D4693A"];

// 8 dots laid out clockwise starting at 12 o'clock. Geometry mirrors
// the static BrandLogo (radius 32 of viewBox 0 0 120 80) so the loop
// reads as "the brand mark, alive".
const CENTER = { x: 60, y: 40 };
const RADIUS = 32;
const DOTS = Array.from({ length: 8 }, (_, i) => {
  const angleDeg = -90 + i * 45;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER.x + RADIUS * Math.cos(angleRad),
    y: CENTER.y + RADIUS * Math.sin(angleRad),
    color: DOT_COLORS[i % DOT_COLORS.length],
  };
});

// Loop duration tuned to feel like a deliberate brand rhythm — long
// enough that each dot's flash registers, short enough that a user
// waiting on a fast query isn't bored. 8 dots × 0.18s stagger = ~1.44s.
const LOOP_DURATION_S = 1.6;
const DOT_STAGGER_S = LOOP_DURATION_S / 8;

export function BrandLoader({
  size = "md",
  label,
  className,
}: BrandLoaderProps) {
  const reduce = useReducedMotion();
  const pixelSize = typeof size === "number" ? size : SIZE_PX[size];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
      className={cn("inline-flex flex-col items-center gap-3", className)}
    >
      <svg
        viewBox="0 0 120 80"
        width={pixelSize}
        height={(pixelSize * 80) / 120}
        aria-hidden="true"
        className="overflow-visible"
      >
        {/* Soft warm glow that breathes with the loop. */}
        <motion.circle
          cx={CENTER.x}
          cy={CENTER.y}
          r={20}
          fill="#E8864A"
          opacity={0.08}
          initial={false}
          animate={
            reduce
              ? { scale: 1, opacity: 0.08 }
              : { scale: [1, 1.18, 1], opacity: [0.04, 0.12, 0.04] }
          }
          transition={
            reduce
              ? undefined
              : {
                  duration: LOOP_DURATION_S,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
          style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }}
        />

        {/* 8 dots flashing in sequence around the ring. */}
        {DOTS.map((d, i) => (
          <motion.circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={3.6}
            fill={d.color}
            initial={false}
            animate={
              reduce
                ? { opacity: 0.85, scale: 1 }
                : { opacity: [0.25, 1, 0.25], scale: [0.85, 1.15, 0.85] }
            }
            transition={
              reduce
                ? undefined
                : {
                    duration: LOOP_DURATION_S,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * DOT_STAGGER_S,
                  }
            }
            style={{ transformOrigin: `${d.x}px ${d.y}px` }}
          />
        ))}

        {/* Center heart — same path as BrandLogo so the silhouette
            stays recognisable. Gentle scale pulse on the loop. */}
        <motion.path
          d="M60 32 C60 28, 54 24, 51 28 C48 32, 53 37, 60 44 C67 37, 72 32, 69 28 C66 24, 60 28, 60 32Z"
          fill="#D4693A"
          initial={false}
          animate={reduce ? { scale: 1 } : { scale: [1, 1.06, 1] }}
          transition={
            reduce
              ? undefined
              : {
                  duration: LOOP_DURATION_S,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
          style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }}
        />
      </svg>

      {label && (
        <span className="text-xs font-medium text-stone-500 tracking-wide">
          {label}
        </span>
      )}
    </div>
  );
}

export default BrandLoader;
