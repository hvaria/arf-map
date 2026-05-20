// BrandSplash — full-screen brand-mark reveal shown on first app
// boot. Native Capacitor's launch image hides ~1.5s after process
// start (configured in capacitor.config.ts); this component takes
// over from there with a soft, deliberate brand reveal so the user
// never sees a blank canvas or a half-rendered route while the
// session queries and first paint are racing.
//
// Visual vocabulary lifted from MarketingLanding's AnimatedBrandMark
// but compressed from ~7s to ~1.4s — the marketing reveal is a
// hero moment; this one is a polite hand-off into the product.
//
// Visibility model: caller owns it. The splash exits with a fade
// when `visible` flips to false. AnimatePresence handles the unmount
// timing so the parent can pass `visible={!ready}` without worrying
// about race conditions during the fade.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export interface BrandSplashProps {
  /**
   * Controls whether the splash is shown. Flip to `false` once the
   * app is ready to take over. The splash fades out cleanly via
   * AnimatePresence; the caller can immediately render the next
   * route on the same render pass.
   */
  visible: boolean;
}

const DOT_COLORS = ["#C25A2E", "#D4693A", "#E8864A", "#D4693A"];
const CENTER = { x: 200, y: 200 };
const RADIUS = 120;

export function BrandSplash({ visible }: BrandSplashProps) {
  const reduce = useReducedMotion();
  // We always start the reveal animation on mount — there's no
  // "don't animate the first time" pathway. State just gates the
  // staggered phases so the dots can animate in sequence.
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    // 60ms grace so the browser commits the initial paint of the
    // backdrop before the SVG starts drawing — prevents a jarring
    // "everything appears at once" flash on slower mobile devices.
    const t = window.setTimeout(() => setReveal(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  const dots = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const angleDeg = -90 + i * 45;
      const angleRad = (angleDeg * Math.PI) / 180;
      return {
        x: CENTER.x + RADIUS * Math.cos(angleRad),
        y: CENTER.y + RADIUS * Math.sin(angleRad),
        color: DOT_COLORS[i % DOT_COLORS.length],
      };
    });
  }, []);

  // Phase timing — compressed from MarketingLanding's 7s reveal to
  // ~1.4s. Reduced-motion users get the final lockup immediately.
  const fast = reduce;
  const T_DOTS = fast ? 0 : 0.2;
  const S_DOTS = fast ? 0 : 0.08;
  const T_HEART = fast ? 0 : 0.85;
  const D = fast ? 0.001 : 0.5;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="brand-splash"
          // Cream-on-warm background mirrors MarketingLanding's
          // canvas so a user who lands on the marketing site after
          // the native shell hands off doesn't perceive a color jump.
          className="fixed inset-0 z-[200] bg-[#FFF8F1] flex items-center justify-center"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          role="status"
          aria-live="polite"
          aria-label="Loading Neighbourhood Care Finder"
        >
          {/* Soft warm glow behind the mark, mirrors AnimatedBrandMark
              so the visual lineage reads as the same brand. */}
          <motion.div
            aria-hidden="true"
            className="absolute w-[420px] h-[420px] rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(closest-side, rgba(232,134,74,0.22), transparent 70%)",
              filter: "blur(30px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: reveal ? 1 : 0 }}
            transition={{ duration: fast ? 0.001 : 0.8, ease: "easeOut" }}
          />

          <svg
            viewBox="0 0 400 400"
            className="relative w-[min(72vw,360px)] aspect-square"
            aria-hidden="true"
          >
            {/* 8 dots fading in sequentially around the ring. */}
            {dots.map((d, i) => (
              <motion.g
                key={`dot-${i}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={
                  reveal ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
                }
                transition={{
                  duration: D,
                  delay: T_DOTS + i * S_DOTS,
                  ease: [0.16, 1, 0.3, 1],
                }}
                style={{ transformOrigin: `${d.x}px ${d.y}px` }}
              >
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={11}
                  fill={d.color}
                  stroke="rgba(255,248,241,0.9)"
                  strokeWidth={1.5}
                />
                <circle
                  cx={d.x}
                  cy={d.y - 2.5}
                  r={3}
                  fill="white"
                  opacity={0.7}
                />
              </motion.g>
            ))}

            {/* Center heart — lands after the ring is in place so
                the eye registers the perimeter first, then the focal
                point. Same shape as the static BrandLogo + the
                marketing reveal. */}
            <motion.path
              d="M200 174 C200 161, 180 148, 170 161 C160 174, 175 190, 200 215 C225 190, 240 174, 230 161 C220 148, 200 161, 200 174Z"
              fill="#D4693A"
              initial={{ scale: 0, opacity: 0 }}
              animate={
                reveal ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
              }
              transition={{
                duration: D * 1.4,
                delay: T_HEART,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }}
            />
          </svg>

          {/* Brand wordmark — fades in last, anchors the splash. */}
          <motion.div
            className="absolute bottom-[12vh] flex flex-col items-center gap-1"
            initial={{ opacity: 0, y: 8 }}
            animate={reveal ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{
              duration: fast ? 0.001 : 0.5,
              delay: fast ? 0 : T_HEART + 0.25,
              ease: "easeOut",
            }}
          >
            <span
              className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[#E8864A]"
              style={{ letterSpacing: "0.28em" }}
            >
              Neighbourhood
            </span>
            <span className="text-2xl font-black text-[#C25A2E] tracking-tight">
              Care<span className="text-stone-900">Finder</span>
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default BrandSplash;
