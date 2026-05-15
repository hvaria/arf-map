import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import type { Map as MaplibreMap } from "maplibre-gl";
import {
  ArrowRight,
  Heart,
  Briefcase,
  Building2,
  ShieldCheck,
  Stethoscope,
  Sparkles,
  Users,
  MapPin,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useSession } from "@/hooks/useSession";

/**
 * MarketingLanding — the public-facing front door at ncaref.com.
 *
 * Dark-mode marketing site. The entire page sits on a deep slate canvas
 * (#0A0E13) so the warm terracotta brand colors glow against it. The hero
 * is a full-bleed dark MapLibre map of a random California neighborhood
 * with the brand logo (heart + 8 facility dots) overlaid on the right; the
 * map slowly drifts in bearing for ambient motion. Subsequent sections
 * use scroll-triggered fade-up reveals, hover glows, and ambient floating
 * orbs to keep the rest of the page alive without competing with the hero.
 *
 * Authenticated visitors see "Go to your portal" instead of "Enter the app"
 * so the marketing page doubles as a way back into the product.
 */
export default function MarketingLanding() {
  const [, navigate] = useLocation();
  const { user: jobSeeker, isReady: jobSeekerReady } = useAuth();
  const { data: facility, isLoading: facilityLoading } = useSession();

  const sessionsReady = jobSeekerReady && !facilityLoading;
  const authedTarget = facility
    ? "/facility-portal"
    : jobSeeker
    ? "/jobseeker/dashboard"
    : null;

  const primaryCta = authedTarget ? "Go to your portal" : "Enter the app";
  const primaryHref = authedTarget ?? "/map";

  return (
    <div className="relative min-h-screen w-full bg-[#FFF8F1] text-stone-900 selection:bg-[#FBEEE5] selection:text-[#7A2E0B] overflow-x-hidden">
      {/* Page-wide ambient warm wash so the cream canvas has depth, not flatness */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(232,134,74,0.10) 0%, rgba(255,248,241,0) 60%)",
        }}
      />

      <NavBar
        onSignIn={() => navigate("/map")}
        onPrimary={() => navigate(primaryHref)}
        primaryLabel={primaryCta}
        sessionsReady={sessionsReady}
      />

      <Hero
        primaryLabel={primaryCta}
        onPrimary={() => navigate(primaryHref)}
        onLearn={() => scrollToId("mission")}
      />

      <Mission />
      <ForCaregivers onCta={() => navigate("/map")} />
      <ForOperators onCta={() => navigate("/map")} />
      <TheStandard />
      <Connection />
      <FinalCta
        label={primaryCta}
        onClick={() => navigate(primaryHref)}
      />
      <Footer />
    </div>
  );
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Animation primitives
 * ──────────────────────────────────────────────────────────────────────── */

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 1.0, ease: [0.16, 1, 0.3, 1] },
  },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};

/** Scroll-triggered stagger container — children must use `FadeUp` to opt in. */
function StaggerSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function FadeUp({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={fadeUp} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * Tilt3D — Antigravity-style cursor-tracked 3D tilt. Children rotate on X/Y
 * axes based on cursor position within the element, springing back to flat
 * when the cursor leaves. Used to make cards and the brand mark feel like
 * they're levitating in space rather than pinned to the page.
 *
 * - `max` caps the rotation amount in degrees (subtle for hero, stronger
 *   for cards).
 * - `glare` overlays a soft white reflection that follows the cursor — the
 *   "light from above" cue that sells the floating illusion.
 * - Respects reduced-motion: returns children unwrapped with no listeners.
 */
function Tilt3D({
  children,
  max = 8,
  glare = false,
  className,
}: {
  children: ReactNode;
  max?: number;
  glare?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0); // normalized -0.5 to 0.5
  const py = useMotionValue(0);
  // Softer spring so the tilt feels deliberate rather than snappy.
  const springConf = { stiffness: 120, damping: 24, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), springConf);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), springConf);
  // Glare position in % across the surface
  const glareX = useTransform(px, [-0.5, 0.5], ["0%", "100%"]);
  const glareY = useTransform(py, [-0.5, 0.5], ["0%", "100%"]);

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        transformPerspective: 1100,
        willChange: "transform",
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - rect.left) / rect.width - 0.5);
        py.set((e.clientY - rect.top) / rect.height - 0.5);
      }}
      onMouseLeave={() => {
        px.set(0);
        py.set(0);
      }}
    >
      {children}
      {glare && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background: useTransform(
              [glareX, glareY] as never,
              ([gx, gy]: string[]) =>
                `radial-gradient(circle at ${gx} ${gy}, rgba(255,255,255,0.16), transparent 45%)`,
            ),
            mixBlendMode: "overlay",
          }}
        />
      )}
    </motion.div>
  );
}

/**
 * AmbientOrbs — three slow-breathing orange radial blooms drift behind the
 * content. Pure decoration, pointer-events: none. The animation is gentle
 * enough that users with reduced-motion preferences get a static version.
 */
function AmbientOrbs() {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden pointer-events-none"
    >
      <motion.div
        className="absolute -top-32 -left-20 w-[40rem] h-[40rem] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(232,134,74,0.16), transparent 70%)",
          filter: "blur(40px)",
        }}
        animate={reduce ? undefined : { y: [0, 24, 0], x: [0, 12, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-40 -right-24 w-[36rem] h-[36rem] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(212,105,58,0.13), transparent 70%)",
          filter: "blur(40px)",
        }}
        animate={reduce ? undefined : { y: [0, -20, 0], x: [0, -16, 0] }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,176,122,0.07), transparent 70%)",
          filter: "blur(30px)",
        }}
        animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * NavBar
 * ──────────────────────────────────────────────────────────────────────── */
function NavBar({
  onSignIn,
  onPrimary,
  primaryLabel,
  sessionsReady,
}: {
  onSignIn: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  sessionsReady: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#FFF8F1]/85 border-b border-stone-200/70">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 h-20 flex items-center justify-between gap-8">
        <a
          href="#/"
          aria-label="Neighbourhood Care Finder home"
          className="flex items-center shrink-0"
        >
          <BrandLogo size={60} />
        </a>

        <nav className="hidden md:flex items-center gap-9 text-[13px] font-medium text-stone-600">
          {[
            ["Mission", "mission"],
            ["For Caregivers", "for-caregivers"],
            ["For Operators", "for-operators"],
            ["The Standard", "standard"],
          ].map(([label, id]) => (
            <button
              key={id}
              type="button"
              className="relative group hover:text-[#E8864A] transition-colors py-2"
              onClick={() => scrollToId(id)}
            >
              {label}
              <span className="absolute bottom-0 left-0 right-0 h-px bg-[#E8864A] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onSignIn}
            className="hidden sm:inline-flex text-[13px] font-semibold text-stone-600 hover:text-[#E8864A] px-2 py-2 rounded-md transition-colors"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onPrimary}
            disabled={!sessionsReady}
            className="relative inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-[#C25A2E] hover:bg-[#A8501F] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors shadow-[0_0_0_1px_rgba(232,134,74,0.45),0_8px_22px_-10px_rgba(232,134,74,0.6)]"
          >
            {primaryLabel}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Hero — full-bleed map + animated brand mark overlay
 * ──────────────────────────────────────────────────────────────────────── */
function Hero({
  primaryLabel,
  onPrimary,
  onLearn,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onLearn: () => void;
}) {
  return (
    <section className="relative -mt-20 min-h-[100svh] overflow-hidden bg-[#FFF8F1]">
      {/* Full-bleed dark map — single fixed Koreatown coordinate, bleeds
          across the whole hero behind the copy and the brand mark. */}
      <HeroMap />

      {/* Layered gradient overlays — heavy darkening on the left so the copy
          stays legible, softer fade on the right where the brand mark sits,
          and a vertical fade to the page background at the bottom. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(90deg, rgba(255,248,241,0.96) 0%, rgba(255,248,241,0.75) 35%, rgba(255,248,241,0.25) 65%, rgba(255,248,241,0.55) 100%),
            linear-gradient(180deg, rgba(255,248,241,0.55) 0%, rgba(255,248,241,0) 25%, rgba(255,248,241,0) 65%, rgba(255,248,241,1) 100%)
          `,
        }}
      />

      <AmbientOrbs />

      {/* Content */}
      <div className="relative pt-24 pb-20 sm:pt-32 sm:pb-28 max-w-[1400px] mx-auto px-6 sm:px-10 min-h-[100svh] flex items-center">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center w-full">
          <div className="lg:col-span-6 text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(232,134,74,0.12)] text-[#C25A2E] text-xs font-semibold tracking-wide uppercase border border-[rgba(232,134,74,0.3)]"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              A new standard for residential care
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="mt-5 font-black tracking-tight text-stone-900 leading-[1.05]"
              style={{ fontSize: "clamp(2.25rem, 4.6vw, 4rem)" }}
            >
              Care is a calling.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #FFB07A 0%, #E8864A 50%, #C25A2E 100%)",
                }}
              >
                We built the platform
              </span>
              <br />
              that finally honors it.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 text-lg sm:text-xl text-stone-600 max-w-xl mx-auto lg:mx-0 leading-relaxed"
            >
              Neighbourhood Care Finder connects caregivers and licensed
              residential homes across California — one shared standard, one
              honest map, one place where good care can be found and good work
              can be honored.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start"
            >
              <GlowButton onClick={onPrimary}>
                {primaryLabel}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </GlowButton>
              <button
                type="button"
                onClick={onLearn}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto text-stone-900 hover:text-[#C25A2E] hover:border-[rgba(232,134,74,0.5)] font-semibold px-6 py-3.5 rounded-xl border border-stone-200 bg-white/[0.03] backdrop-blur-md transition-colors text-base"
              >
                Read our mission
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.2, delay: 1.25 }}
              className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center lg:justify-start text-xs text-stone-500"
            >
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#E8864A]" aria-hidden="true" />
                Serving California
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#E8864A]" aria-hidden="true" />
                ARF &amp; RCFE licensed
              </div>
              <div className="flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-[#E8864A]" aria-hidden="true" />
                Built by people who care
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-6 flex justify-center relative">
            <AnimatedBrandMark />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * GlowButton — the primary CTA. Wrapped in a relative div so the orange
 * "pulse" ring stays anchored to the button regardless of layout.
 */
function GlowButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="relative w-full sm:w-auto">
      {/* Soft pulsing halo */}
      {!reduce && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            background:
              "radial-gradient(closest-side, rgba(232,134,74,0.6), transparent 70%)",
            filter: "blur(18px)",
          }}
          animate={{ opacity: [0.55, 0.9, 0.55] }}
          transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        className="relative inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-gradient-to-br from-[#E8864A] to-[#C25A2E] hover:from-[#F09659] hover:to-[#D4693A] text-white font-semibold px-6 py-3.5 rounded-xl text-base transition-colors shadow-[0_0_0_1px_rgba(255,176,122,0.4),0_12px_28px_-8px_rgba(232,134,74,0.6)]"
      >
        {children}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * AnimatedBrandMark — the full brand story in a single 3D scene.
 *
 * A stylized dark city grid backdrop (deterministic — same composition on
 * every load) with the heart at the center, eight facility points spaced
 * clockwise around it, and connecting spokes. On top of the static scene,
 * three loops continually reinforce the metaphor: the heart pulses, ripple
 * rings expand outward from the center (the platform radiating out), and
 * tiny particles stream inward along each spoke (connections flowing back
 * to the platform). Cursor-tracked Tilt3D wrapper sells the depth.
 *
 * Replaces the earlier live-map embed — the live map's random street view
 * sometimes parked the eight facility dots on rivers or off-road, which
 * broke the metaphor.
 * ──────────────────────────────────────────────────────────────────────── */
/**
 * HeroMap — the full-bleed dark MapLibre map behind the hero copy and brand
 * mark. Pinned to a single deterministic coordinate (Koreatown, LA) so the
 * composition is identical on every load. Lazy-imported so the marketing
 * page's initial JS bundle stays small.
 */
function HeroMap() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: maplibregl } = await import("maplibre-gl");
      if (cancelled || !mapContainer.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: mapContainer.current,
        style:
          "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [-118.2837, 34.0689], // Koreatown, Los Angeles — fixed
        zoom: 15.6,
        bearing: -8,
        interactive: false,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    // Map fades in smoothly on mount — this is the first beat of the brand
    // reveal sequence ("map outline appearing first, clean and elegant").
    <motion.div
      ref={mapContainer}
      className="absolute inset-0"
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}

/**
 * Animation timeline (seconds after `reveal` flips true):
 *
 *   0.0 – 1.6  HeroMap fades in (handled inside HeroMap, this matches it)
 *   1.6 – 5.0  Building marker → orange dot morph, clockwise (8 × 0.45s
 *              stagger × 0.55s morph). Each marker is a small dim rect that
 *              cross-fades into the orange facility dot.
 *   5.4 – 6.4  Center heart entrance + warm halo fade-in.
 *   6.5 – 8.3  Thin lines draw inward from each outer point to the center
 *              heart, clockwise, smooth ease.
 *   8.3+       Final lockup — balanced and still.
 *
 * Outer points stay as orange dots (the brand-logo form). No looping
 * animations after the reveal lands. Tilt3D is the only ongoing
 * interaction (cursor-driven tilt).
 */
function AnimatedBrandMark() {
  const reduce = useReducedMotion();
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setReveal(true), 80);
    return () => window.clearTimeout(t);
  }, []);

  const center = { x: 200, y: 200 };
  const radius = 138;
  const dots = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const angleDeg = -90 + i * 45;
      const angleRad = (angleDeg * Math.PI) / 180;
      return {
        x: center.x + radius * Math.cos(angleRad),
        y: center.y + radius * Math.sin(angleRad),
        color: ["#C25A2E", "#D4693A", "#E8864A", "#D4693A"][i % 4],
      };
    });
  }, []);

  // Phase start times + per-element duration / stagger. Reduced-motion users
  // get the final lockup at t≈0.001s with no motion in between.
  const fast = reduce;
  const T_BUILD = fast ? 0 : 1.6; // building→dot morph starts
  const D_BUILD = fast ? 0.001 : 0.55;
  const S_BUILD = fast ? 0 : 0.45;
  // Small beat (~0.4s) between the last dot landing and the center heart
  // entering, so the reveal feels deliberate and the eye registers the
  // ring of dots before the heart appears at the center.
  const T_CENTER =
    fast ? 0 : T_BUILD + S_BUILD * 7 + D_BUILD * 0.6 + 0.4; // ~5.4
  const D_CENTER = fast ? 0.001 : 1.0;
  const T_LINE = fast ? 0 : T_CENTER + D_CENTER * 1.1; // ~6.5
  const D_LINE = fast ? 0.001 : 0.6;
  const S_LINE = fast ? 0 : 0.22;

  return (
    <Tilt3D max={5} className="relative w-full max-w-[560px] aspect-square">
      {/* Soft warm glow behind — fades in alongside the map outline so the
          mark always sits in a lit pool. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(232,134,74,0.22), transparent 70%)",
          filter: "blur(30px)",
          transform: "translateZ(-30px)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: reveal ? 1 : 0 }}
        transition={{ duration: fast ? 0.001 : 1.8, ease: "easeOut" }}
      />
      {/* Floating drop-shadow under the mark */}
      <motion.div
        aria-hidden="true"
        className="absolute left-[15%] right-[15%] bottom-2 h-12 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.55), transparent 70%)",
          filter: "blur(18px)",
          transform: "translateZ(-60px)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: reveal ? 1 : 0 }}
        transition={{ duration: fast ? 0.001 : 1.8, ease: "easeOut" }}
      />

      <svg
        viewBox="0 0 400 400"
        className="relative w-full h-full"
        role="img"
        aria-label="Neighbourhood Care Finder mark: a heart at the center with eight facility points connected clockwise around it, on a dark map of California."
      >
        <defs>
          <radialGradient id="heartGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E8864A" stopOpacity="0.75" />
            <stop offset="55%" stopColor="#E8864A" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#E8864A" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E8864A" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#E8864A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="heartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F09659" />
            <stop offset="100%" stopColor="#C25A2E" />
          </linearGradient>
        </defs>

        {/* ── Phase 2 ──  Building markers cross-fade into orange dots,
            clockwise. The rect is the "building", the circle group is the
            facility dot. They overlap in time so the building seems to morph
            into a dot rather than just swap. */}
        {dots.map((d, i) => {
          const delayBuild = T_BUILD + i * S_BUILD;
          // Building rect: appears → peaks → dissolves
          return (
            <motion.rect
              key={`bldg-${i}`}
              x={d.x - 7}
              y={d.y - 7}
              width={14}
              height={14}
              rx={1.5}
              // Slightly lighter than the dark-matter style's building tone
              // so it reads as a building landmark on the map without looking
              // like a foreign SVG element. No stroke — the dark map's
              // building rendering doesn't use one either.
              fill="#3A4350"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={
                reveal
                  ? { opacity: [0, 0.95, 0.95, 0], scale: [0.5, 1, 1, 0.75] }
                  : { opacity: 0, scale: 0.5 }
              }
              transition={{
                duration: D_BUILD,
                delay: delayBuild,
                times: [0, 0.35, 0.6, 1],
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                transformOrigin: `${d.x}px ${d.y}px`,
                transformBox: "fill-box",
              }}
            />
          );
        })}

        {dots.map((d, i) => {
          // Dot scales in from 0, landing as the building rect dissolves.
          const delayDot = T_BUILD + i * S_BUILD + D_BUILD * 0.5;
          return (
            <motion.g
              key={`dot-${i}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={
                reveal ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
              }
              transition={{
                duration: fast ? 0.001 : 0.55,
                delay: delayDot,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{ transformOrigin: `${d.x}px ${d.y}px` }}
            >
              <circle cx={d.x} cy={d.y} r={12} fill="url(#dotGlow)" />
              <circle
                cx={d.x}
                cy={d.y}
                r={5.5}
                fill={d.color}
                stroke="rgba(255,248,241,0.9)"
                strokeWidth={1.2}
              />
              <circle
                cx={d.x}
                cy={d.y - 1.4}
                r={1.6}
                fill="white"
                opacity={0.75}
              />
            </motion.g>
          );
        })}

        {/* ── Phase 4 ──  Connection lines draw inward from each outer dot
            to the center heart, clockwise. Soft easing, thin stroke. Drawn
            BELOW the dots and center heart so the line endings tuck under
            the marker shapes. */}
        {dots.map((d, i) => {
          const delay = T_LINE + i * S_LINE;
          // Line origin sits just outside the outer dot, and terminates
          // just outside the center heart's silhouette.
          const dx = center.x - d.x;
          const dy = center.y - d.y;
          const len = Math.hypot(dx, dy);
          const startTrim = 12;
          const endTrim = 38;
          const sx = d.x + (dx / len) * startTrim;
          const sy = d.y + (dy / len) * startTrim;
          const ex = center.x - (dx / len) * endTrim;
          const ey = center.y - (dy / len) * endTrim;
          const dash = Math.hypot(ex - sx, ey - sy);
          return (
            <motion.line
              key={`line-${i}`}
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke="#E8864A"
              strokeOpacity={0.9}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeDasharray={dash}
              initial={{ strokeDashoffset: dash }}
              animate={
                reveal ? { strokeDashoffset: 0 } : { strokeDashoffset: dash }
              }
              transition={{
                duration: D_LINE,
                delay,
                ease: [0.4, 0, 0.2, 1],
              }}
            />
          );
        })}

        {/* ── Phase 3 ──  Center heart halo + heart entrance. No heartbeat
            loop — once the heart lands, it stays still. */}
        <motion.circle
          cx={center.x}
          cy={center.y}
          r={72}
          fill="url(#heartGlow)"
          initial={{ opacity: 0 }}
          animate={{ opacity: reveal ? 1 : 0 }}
          transition={{
            duration: fast ? 0.001 : 1.0,
            delay: T_CENTER,
            ease: "easeOut",
          }}
        />
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={
            reveal
              ? { scale: [0, 1.18, 1], opacity: 1 }
              : { scale: 0, opacity: 0 }
          }
          transition={{
            duration: D_CENTER,
            delay: T_CENTER,
            times: [0, 0.6, 1],
            ease: [0.16, 1.2, 0.3, 1],
          }}
          style={{ transformOrigin: `${center.x}px ${center.y}px` }}
        >
          <BrandHeart cx={center.x} cy={center.y} />
        </motion.g>
      </svg>
    </Tilt3D>
  );
}


function BrandHeart({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <path
        d="
          M 0 -8
          C 0 -32, -32 -48, -42 -28
          C -52 -8, -28 16, 0 44
          C 28 16, 52 -8, 42 -28
          C 32 -48, 0 -32, 0 -8 Z
        "
        fill="url(#heartFill)"
      />
    </g>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * SectionShell — common dark-section wrapper with optional ambient orbs
 * ──────────────────────────────────────────────────────────────────────── */
function SectionShell({
  id,
  children,
  withOrbs = false,
  surface = "deep",
}: {
  id?: string;
  children: ReactNode;
  withOrbs?: boolean;
  surface?: "deep" | "elev";
}) {
  return (
    <section
      id={id}
      className={`relative border-t border-stone-200/70 ${
        surface === "elev" ? "bg-white" : "bg-[#FFF8F1]"
      } overflow-hidden`}
    >
      {withOrbs && <AmbientOrbs />}
      <div className="relative">{children}</div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Mission
 * ──────────────────────────────────────────────────────────────────────── */
function Mission() {
  return (
    <SectionShell id="mission" withOrbs>
      <div className="max-w-4xl mx-auto px-6 sm:px-10 py-24 sm:py-32 text-center">
        <StaggerSection>
          <FadeUp>
            <p className="portal-eyebrow text-[#C25A2E]">Our mission</p>
          </FadeUp>
          <FadeUp>
            <h2
              className="mt-4 font-bold leading-tight"
              style={{ fontSize: "clamp(1.875rem, 3.3vw, 2.75rem)" }}
            >
              <span className="text-stone-900">
                The care industry runs on people, paper, and hope.
              </span>
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #FFB07A 0%, #E8864A 50%, #C25A2E 100%)",
                }}
              >
                We&rsquo;re replacing the paper. Keeping the people. Lifting
                the hope.
              </span>
            </h2>
          </FadeUp>

          <div className="mt-12 space-y-6 text-lg text-stone-600 leading-relaxed max-w-2xl mx-auto">
            <FadeUp>
              <p>
                Residential care is one of the most human industries in the
                world, and one of the least standardized. A caregiver in
                Bakersfield does the same work as a caregiver in Berkeley, but
                they live in two different systems — different forms, different
                rules, different chances of being seen.
              </p>
            </FadeUp>
            <FadeUp>
              <p>
                We started Neighbourhood Care Finder because the people who do
                this work deserve a place to be found. And the families who
                depend on this work deserve a place to find them. One map. One
                standard. One honest place where the people who give care can
                meet the homes that need them.
              </p>
            </FadeUp>
            <FadeUp>
              <p className="text-[#C25A2E] font-semibold">
                Care is a calling. It&rsquo;s time the industry that runs on it
                felt like a calling too.
              </p>
            </FadeUp>
          </div>
        </StaggerSection>
      </div>
    </SectionShell>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ForCaregivers
 * ──────────────────────────────────────────────────────────────────────── */
function ForCaregivers({ onCta }: { onCta: () => void }) {
  return (
    <SectionShell id="for-caregivers" surface="elev">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-24 sm:py-32">
        <StaggerSection className="grid lg:grid-cols-12 gap-12 items-center">
          <FadeUp className="lg:col-span-5 order-2 lg:order-1">
            <QuoteCard
              icon={<Briefcase className="w-10 h-10" aria-hidden="true" />}
              quote={
                <>
                  &ldquo;Behind every shift
                  <br />
                  is a person showing up
                  <br />
                  at someone&rsquo;s most
                  <br />
                  vulnerable hour.&rdquo;
                </>
              }
              caption={
                <>
                  Find work that pays you
                  <br />
                  what your heart already gives.
                </>
              }
            />
          </FadeUp>

          <div className="lg:col-span-7 order-1 lg:order-2">
            <FadeUp>
              <p className="portal-eyebrow text-[#C25A2E]">For caregivers</p>
            </FadeUp>
            <FadeUp>
              <h2
                className="mt-3 font-bold text-stone-900 leading-tight"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
              >
                Your work changes lives.
                <br />
                <span className="text-[#C25A2E]">
                  Your career should change too.
                </span>
              </h2>
            </FadeUp>
            <FadeUp>
              <p className="mt-6 text-lg text-stone-600 leading-relaxed">
                Caregivers, DSPs, nurses, med techs, house managers — the
                people who hold the residential care system together are
                usually the last to be heard. We built the job-seeker side of
                Neighbourhood Care Finder to put them first.
              </p>
            </FadeUp>

            <div className="mt-8 grid sm:grid-cols-2 gap-5">
              <FadeUp>
                <Bullet
                  title="Be visible to homes near you"
                  body="One profile, one map. Local licensed homes can see who you are, what you do, and what you&rsquo;re looking for."
                />
              </FadeUp>
              <FadeUp>
                <Bullet
                  title="Real roles. Real pay."
                  body="No bait-and-switch postings. Every job is tied to a real licensed facility we&rsquo;ve verified on the state registry."
                />
              </FadeUp>
              <FadeUp>
                <Bullet
                  title="Apply with dignity"
                  body="Express interest in seconds, message directly, and own your story — not a generic resume someone else picked from a pile."
                />
              </FadeUp>
              <FadeUp>
                <Bullet
                  title="Grow with the industry"
                  body="As homes adopt better standards, the caregivers in our network are the ones they hire first."
                />
              </FadeUp>
            </div>

            <FadeUp>
              <div className="mt-10">
                <SectionCta onClick={onCta} label="Find work that fits" />
              </div>
            </FadeUp>
          </div>
        </StaggerSection>
      </div>
    </SectionShell>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ForOperators
 * ──────────────────────────────────────────────────────────────────────── */
function ForOperators({ onCta }: { onCta: () => void }) {
  return (
    <SectionShell id="for-operators">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-24 sm:py-32">
        <StaggerSection className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <FadeUp>
              <p className="portal-eyebrow text-[#C25A2E]">
                For facility operators
              </p>
            </FadeUp>
            <FadeUp>
              <h2
                className="mt-3 font-bold text-stone-900 leading-tight"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
              >
                You opened your home to
                <br />
                <span className="text-[#C25A2E]">
                  other people&rsquo;s parents,
                </span>
                <br />
                siblings, and children.
              </h2>
            </FadeUp>
            <FadeUp>
              <p className="mt-6 text-lg text-stone-600 leading-relaxed">
                We built the operations side of Neighbourhood Care Finder so
                that the people running ARFs and RCFEs can keep loving the
                work. eMAR, trackers, incidents, CRM, staff, compliance —
                every part of your day organized in one place, on one shared
                standard.
              </p>
            </FadeUp>

            <div className="mt-8 grid sm:grid-cols-2 gap-5">
              <FadeUp>
                <Bullet
                  title="Run the house, not the paperwork"
                  body="Med pass, ADLs, vitals, sleep, hygiene, skin checks — all the trackers a licensed home needs, designed to take seconds, not hours."
                />
              </FadeUp>
              <FadeUp>
                <Bullet
                  title="Stay licensed, stay calm"
                  body="California ARF and RCFE rules built into how the product behaves. The standard isn&rsquo;t bolted on — it&rsquo;s the foundation."
                />
              </FadeUp>
              <FadeUp>
                <Bullet
                  title="Hire from a real local network"
                  body="Post a role, see real caregivers near you, message directly. No middlemen, no fake resumes, no cold leads."
                />
              </FadeUp>
              <FadeUp>
                <Bullet
                  title="One source of truth for your team"
                  body="Shifts, notes, alerts, residents, families — everyone on the same page, on the same map, on the same care plan."
                />
              </FadeUp>
            </div>

            <FadeUp>
              <div className="mt-10">
                <SectionCta
                  onClick={onCta}
                  label="See the operations portal"
                />
              </div>
            </FadeUp>
          </div>

          <FadeUp className="lg:col-span-5">
            <QuoteCard
              icon={<Building2 className="w-10 h-10" aria-hidden="true" />}
              quote={
                <>
                  &ldquo;We built the tools
                  <br />
                  so you can keep them safe —
                  <br />
                  and keep loving the work.&rdquo;
                </>
              }
              caption={
                <>
                  Compliance, care, and community
                  <br />
                  in one operations portal.
                </>
              }
              orientation="deep"
            />
          </FadeUp>
        </StaggerSection>
      </div>
    </SectionShell>
  );
}

/**
 * QuoteCard — dark surface, glowing icon, oversized quote. Used by both
 * audience sections.
 */
function QuoteCard({
  icon,
  quote,
  caption,
  orientation = "light",
}: {
  icon: ReactNode;
  quote: ReactNode;
  caption: ReactNode;
  orientation?: "light" | "deep";
}) {
  const iconBg =
    orientation === "deep"
      ? "linear-gradient(135deg, #C25A2E, #7A2E0B)"
      : "linear-gradient(135deg, #FFB07A, #C25A2E)";
  return (
    <Tilt3D max={7} glare className="relative aspect-[4/5] group">
      {/* Floating shadow underneath — drops the card off the page in Z */}
      <div
        aria-hidden="true"
        className="absolute inset-x-6 -bottom-4 h-12 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.6), transparent 70%)",
          filter: "blur(22px)",
          transform: "translateZ(-80px)",
        }}
      />

      {/* Animated soft gradient border on hover */}
      <div
        aria-hidden="true"
        className="absolute -inset-px rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background:
            "conic-gradient(from 180deg at 50% 50%, rgba(232,134,74,0.45), transparent 25%, rgba(212,105,58,0.4) 50%, transparent 75%, rgba(232,134,74,0.45))",
          filter: "blur(10px)",
          transform: "translateZ(-10px)",
        }}
      />

      {/* Glass-morphism panel */}
      <div
        className="relative h-full rounded-3xl overflow-hidden border border-stone-200"
        style={{
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.95) 0%, rgba(250,250,249,0.85) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.7), 0 24px 50px -22px rgba(28,25,23,0.18), 0 0 0 1px rgba(232,134,74,0.10)",
        }}
      >
        {/* Top reflective edge — sells the "panel under light" cue */}
        <div
          aria-hidden="true"
          className="absolute top-0 inset-x-8 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,176,122,0.55), transparent)",
          }}
        />

        {/* Inner warm glow */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 30%, rgba(232,134,74,0.18) 0%, transparent 70%)",
          }}
        />

        {/* Content — pushed forward in Z so it floats above the surface */}
        <div className="relative h-full flex items-center justify-center">
          <div
            className="text-center px-8"
            style={{ transform: "translateZ(28px)" }}
          >
            <div
              className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center text-white"
              style={{
                background: iconBg,
                boxShadow:
                  "0 14px 32px -8px rgba(232,134,74,0.65), inset 0 1px 0 rgba(255,255,255,0.25)",
                transform: "translateZ(20px)",
              }}
            >
              {icon}
            </div>
            <p className="mt-7 text-2xl font-black text-stone-900 leading-tight">
              {quote}
            </p>
            <p className="mt-4 text-sm text-stone-600">{caption}</p>
          </div>
        </div>
      </div>
    </Tilt3D>
  );
}

/**
 * SectionCta — secondary CTA used inside audience sections.
 */
function SectionCta({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900 bg-gradient-to-br from-[#E8864A] to-[#C25A2E] hover:from-[#F09659] hover:to-[#D4693A] px-5 py-3 rounded-xl transition-colors shadow-[0_0_0_1px_rgba(255,176,122,0.3),0_10px_24px_-10px_rgba(232,134,74,0.6)]"
    >
      {label}
      <ArrowRight className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * TheStandard — four pillars on dark glowing cards
 * ──────────────────────────────────────────────────────────────────────── */
function TheStandard() {
  const pillars = [
    {
      icon: ShieldCheck,
      title: "Licensed by default",
      body: "We start from the California state registry of every licensed ARF and RCFE. If a facility isn’t licensed, it isn’t on our map. Period.",
    },
    {
      icon: Stethoscope,
      title: "Care done the same way",
      body: "Med pass, vitals, ADLs, sleep, incidents — recorded the same way in every home that uses us, so quality is measurable, not anecdotal.",
    },
    {
      icon: Users,
      title: "People before profiles",
      body: "Caregivers aren’t a list of skills. Operators aren’t a license number. Both sides get a real story, on a real map, in front of real people.",
    },
    {
      icon: Heart,
      title: "Built with the industry",
      body: "Every feature comes from a real conversation with a real home or a real caregiver. We don’t ship for show — we ship for shifts.",
    },
  ];

  return (
    <SectionShell id="standard" surface="elev" withOrbs>
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-24 sm:py-32">
        <StaggerSection>
          <FadeUp>
            <p className="portal-eyebrow text-[#C25A2E]">The standard</p>
          </FadeUp>
          <FadeUp className="max-w-3xl">
            <h2
              className="mt-3 font-bold text-stone-900 leading-tight"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
            >
              The residential care industry doesn&rsquo;t need another vendor.
              <br />
              <span className="text-[#C25A2E]">It needs a standard.</span>
            </h2>
          </FadeUp>
          <FadeUp className="max-w-3xl">
            <p className="mt-6 text-lg text-stone-600 leading-relaxed">
              Four principles guide every feature, every conversation, every
              line of code we ship. They&rsquo;re what we mean when we say
              we&rsquo;re standardizing this industry from the inside out.
            </p>
          </FadeUp>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {pillars.map((p, i) => {
              const Icon = p.icon;
              return (
                <FadeUp key={p.title}>
                  <PillarCard
                    icon={<Icon className="w-5 h-5" aria-hidden="true" />}
                    title={p.title}
                    body={p.body}
                    deep={i % 2 === 1}
                  />
                </FadeUp>
              );
            })}
          </div>
        </StaggerSection>
      </div>
    </SectionShell>
  );
}

function PillarCard({
  icon,
  title,
  body,
  deep,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  deep?: boolean;
}) {
  return (
    <Tilt3D max={9} className="group relative h-full">
      {/* Soft floating shadow underneath the card */}
      <div
        aria-hidden="true"
        className="absolute inset-x-4 -bottom-3 h-8 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.55), transparent 70%)",
          filter: "blur(16px)",
          transform: "translateZ(-60px)",
        }}
      />

      {/* Hover halo — glows from the top edge */}
      <div
        aria-hidden="true"
        className="absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, rgba(232,134,74,0.4), transparent 60%)",
          filter: "blur(12px)",
          transform: "translateZ(-10px)",
        }}
      />

      {/* Glass panel */}
      <div
        className="relative h-full rounded-2xl p-6 border border-stone-200 group-hover:border-[rgba(232,134,74,0.4)] transition-colors overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.95) 0%, rgba(250,250,249,0.85) 100%)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.85), 0 18px 36px -18px rgba(28,25,23,0.18)",
        }}
      >
        {/* Top reflective edge */}
        <div
          aria-hidden="true"
          className="absolute top-0 inset-x-4 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,176,122,0.4), transparent)",
          }}
        />

        {/* Icon — floats forward on hover */}
        <div
          className="relative w-11 h-11 rounded-xl flex items-center justify-center text-white"
          style={{
            background: deep
              ? "linear-gradient(135deg, #C25A2E, #7A2E0B)"
              : "linear-gradient(135deg, #FFB07A, #C25A2E)",
            boxShadow:
              "0 10px 26px -8px rgba(232,134,74,0.6), inset 0 1px 0 rgba(255,255,255,0.22)",
            transform: "translateZ(30px)",
          }}
        >
          {icon}
        </div>
        <h3
          className="relative mt-5 text-lg font-bold text-stone-900"
          style={{ transform: "translateZ(16px)" }}
        >
          {title}
        </h3>
        <p
          className="relative mt-2 text-sm text-stone-600 leading-relaxed"
          style={{ transform: "translateZ(8px)" }}
        >
          {body}
        </p>
      </div>
    </Tilt3D>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Connection — heart with expanding ripples; the emotional pivot
 * ──────────────────────────────────────────────────────────────────────── */
function Connection() {
  const reduce = useReducedMotion();
  return (
    <SectionShell>
      <div className="max-w-5xl mx-auto px-6 sm:px-10 py-24 sm:py-32 text-center">
        <StaggerSection>
          <FadeUp>
            <p className="portal-eyebrow text-[#C25A2E]">
              Why both sides matter
            </p>
          </FadeUp>
          <FadeUp>
            <h2
              className="mt-3 font-bold leading-tight"
              style={{ fontSize: "clamp(1.875rem, 3.3vw, 2.75rem)" }}
            >
              <span className="text-stone-900">
                A great home is nothing without great people.
              </span>
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #FFB07A 0%, #E8864A 50%, #C25A2E 100%)",
                }}
              >
                A great caregiver is nothing without a home that gets it.
              </span>
            </h2>
          </FadeUp>
          <FadeUp>
            <p className="mt-8 text-lg text-stone-600 leading-relaxed max-w-2xl mx-auto">
              That&rsquo;s why we built both sides under one roof. Every job
              seeker on our platform sees the same facilities every operator
              can claim. Every operator on our platform draws from the same
              pool of caregivers every job seeker can join. One network. One
              standard. One California.
            </p>
          </FadeUp>

          <FadeUp>
            <div className="mt-12 flex justify-center">
              <RippleHeart reduce={reduce} />
            </div>
          </FadeUp>

          <FadeUp>
            <div className="mt-10 inline-flex items-center gap-3 px-5 py-3 rounded-full bg-[rgba(232,134,74,0.1)] text-[#C25A2E] border border-[rgba(232,134,74,0.3)]">
              <Heart className="w-4 h-4" aria-hidden="true" />
              <span className="text-sm font-semibold">
                Built so the people who care can find each other.
              </span>
            </div>
          </FadeUp>
        </StaggerSection>
      </div>
    </SectionShell>
  );
}

/**
 * RippleHeart — a glowing heart with three expanding rings (heartbeat ripple).
 * Visual centerpiece for the Connection section.
 */
function RippleHeart({ reduce }: { reduce: boolean | null }) {
  const ringDelays = [0, 1, 2];
  return (
    <div className="relative w-40 h-40">
      {!reduce &&
        ringDelays.map((delay) => (
          <motion.span
            key={delay}
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-[#E8864A]"
            initial={{ opacity: 0.6, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{
              duration: 4.5,
              repeat: Infinity,
              delay: delay * 1.5,
              ease: "easeOut",
            }}
          />
        ))}
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(232,134,74,0.35), transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      <motion.div
        className="relative w-full h-full flex items-center justify-center"
        animate={
          reduce
            ? undefined
            : { scale: [1, 1.08, 1, 1.05, 1] }
        }
        transition={{
          duration: 2.3,
          repeat: Infinity,
          repeatDelay: 1.4,
          ease: "easeInOut",
          times: [0, 0.18, 0.36, 0.54, 1],
        }}
      >
        <svg viewBox="0 0 120 120" className="w-32 h-32">
          <defs>
            <linearGradient id="rippleHeartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFB07A" />
              <stop offset="100%" stopColor="#C25A2E" />
            </linearGradient>
          </defs>
          <path
            d="
              M 60 50
              C 60 28, 32 18, 22 38
              C 12 58, 36 80, 60 102
              C 84 80, 108 58, 98 38
              C 88 18, 60 28, 60 50 Z
            "
            fill="url(#rippleHeartFill)"
          />
        </svg>
      </motion.div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * FinalCta
 * ──────────────────────────────────────────────────────────────────────── */
function FinalCta({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <SectionShell surface="elev" withOrbs>
      <div className="max-w-4xl mx-auto px-6 sm:px-10 py-24 sm:py-32 text-center relative">
        <StaggerSection>
          <FadeUp>
            <div className="inline-flex items-center justify-center mb-6">
              <BrandLogo size={60} />
            </div>
          </FadeUp>
          <FadeUp>
            <h2
              className="font-bold leading-tight"
              style={{ fontSize: "clamp(2rem, 3.6vw, 3rem)" }}
            >
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #FFB07A 0%, #E8864A 50%, #C25A2E 100%)",
                }}
              >
                Step into the network.
              </span>
            </h2>
          </FadeUp>
          <FadeUp>
            <p className="mt-5 text-lg text-stone-600 max-w-xl mx-auto leading-relaxed">
              Whether you give care or run a home that gives it — there&rsquo;s
              a place for you on the map.
            </p>
          </FadeUp>
          <FadeUp>
            <div className="mt-10 flex flex-col sm:flex-row items-center gap-3 justify-center">
              <GlowButton onClick={onClick}>
                {label}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </GlowButton>
            </div>
          </FadeUp>
        </StaggerSection>
      </div>
    </SectionShell>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Footer
 * ──────────────────────────────────────────────────────────────────────── */
function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-stone-200/70 bg-[#FFF8F1]">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandLogo size={80} />
        </div>
        <div className="text-xs text-stone-500 text-left sm:text-right space-y-1.5 leading-relaxed">
          <p>
            © {year} Neighbourhood Care Finder. Serving California&rsquo;s
            licensed adult residential care community.
          </p>
          <p className="text-[#4A5560]">
            Map tiles ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-stone-600 transition-colors underline-offset-2 hover:underline"
            >
              OpenStreetMap
            </a>{" "}
            contributors, ©{" "}
            <a
              href="https://carto.com/attributions"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-stone-600 transition-colors underline-offset-2 hover:underline"
            >
              CARTO
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Bullet
 * ──────────────────────────────────────────────────────────────────────── */
function Bullet({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3 group">
      <div
        className="mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 transition-shadow"
        style={{
          background: "#E8864A",
          boxShadow: "0 0 0 4px rgba(232,134,74,0.15)",
        }}
        aria-hidden="true"
      />
      <div>
        <p className="font-semibold text-stone-900 group-hover:text-[#C25A2E] transition-colors">
          {title}
        </p>
        <p className="mt-1 text-sm text-stone-600 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
