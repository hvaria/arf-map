import {
  useEffect,
  useMemo,
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
    <div className="relative min-h-screen w-full bg-[#0A0E13] text-[#F5EFE7] selection:bg-[#E8864A] selection:text-[#0A0E13] overflow-x-hidden">
      {/* Page-wide ambient gradient so the dark canvas has depth, not flatness */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(232,134,74,0.08) 0%, rgba(10,14,19,0) 60%)",
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
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
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
  const springConf = { stiffness: 180, damping: 22, mass: 0.4 };
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
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-40 -right-24 w-[36rem] h-[36rem] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(212,105,58,0.13), transparent 70%)",
          filter: "blur(40px)",
        }}
        animate={reduce ? undefined : { y: [0, -20, 0], x: [0, -16, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,176,122,0.07), transparent 70%)",
          filter: "blur(30px)",
        }}
        animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
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
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#0A0E13]/85 border-b border-white/[0.06]">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 h-20 flex items-center justify-between gap-8">
        <a
          href="#/"
          aria-label="Neighbourhood Care Finder home"
          className="flex items-center shrink-0"
        >
          <BrandLogo size={80} />
        </a>

        <nav className="hidden md:flex items-center gap-9 text-[13px] font-medium text-[#A8B0BA]">
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
            className="hidden sm:inline-flex text-[13px] font-semibold text-[#A8B0BA] hover:text-[#E8864A] px-2 py-2 rounded-md transition-colors"
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
    <section className="relative -mt-20 min-h-[100svh] overflow-hidden bg-[#0A0E13]">
      {/* Subtle hero vignette so the centerpiece sits in the lit middle */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(60% 70% at 70% 50%, rgba(232,134,74,0.06) 0%, rgba(10,14,19,0) 65%),
            linear-gradient(180deg, rgba(10,14,19,0) 60%, rgba(10,14,19,1) 100%)
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
              transition={{ duration: 0.5, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(232,134,74,0.12)] text-[#FFB07A] text-xs font-semibold tracking-wide uppercase border border-[rgba(232,134,74,0.3)]"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              A new standard for residential care
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-5 font-black tracking-tight text-[#F5EFE7] leading-[1.05]"
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
              transition={{ duration: 0.7, delay: 0.35 }}
              className="mt-6 text-lg sm:text-xl text-[#A8B0BA] max-w-xl mx-auto lg:mx-0 leading-relaxed"
            >
              Neighbourhood Care Finder connects caregivers and licensed
              residential homes across California — one shared standard, one
              honest map, one place where good care can be found and good work
              can be honored.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.5 }}
              className="mt-8 flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start"
            >
              <GlowButton onClick={onPrimary}>
                {primaryLabel}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </GlowButton>
              <button
                type="button"
                onClick={onLearn}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto text-[#F5EFE7] hover:text-[#FFB07A] hover:border-[rgba(232,134,74,0.5)] font-semibold px-6 py-3.5 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md transition-colors text-base"
              >
                Read our mission
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.8 }}
              className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center lg:justify-start text-xs text-[#6B7480]"
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
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
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

  const baseDelay = reduce ? 0 : 0.5;
  const step = reduce ? 0 : 0.1;

  return (
    <Tilt3D max={5} className="relative w-full max-w-[560px] aspect-square">
      {/* Soft warm glow behind so the mark feels lit from within */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(232,134,74,0.22), transparent 70%)",
          filter: "blur(30px)",
          transform: "translateZ(-30px)",
        }}
      />
      {/* Floating drop-shadow under the mark — fades into the dark canvas */}
      <div
        aria-hidden="true"
        className="absolute left-[15%] right-[15%] bottom-2 h-12 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.55), transparent 70%)",
          filter: "blur(18px)",
          transform: "translateZ(-60px)",
        }}
      />

      <svg
        viewBox="0 0 400 400"
        className="relative w-full h-full"
        role="img"
        aria-label="Neighbourhood Care Finder mark: a heart at the center with eight facility points spaced clockwise around it."
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
          {/* Vignette darkens the panel edges so the heart sits in a lit pool */}
          <radialGradient id="panelVignette" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#0E141B" stopOpacity="0" />
            <stop offset="100%" stopColor="#070A0D" stopOpacity="0.85" />
          </radialGradient>
          {/* Rounded clip so the grid never bleeds past the panel's rounded corners */}
          <clipPath id="panelClip">
            <rect x="0" y="0" width="400" height="400" rx="22" ry="22" />
          </clipPath>
        </defs>

        {/* Map panel base — a stylized "neighborhood" backdrop. Deterministic
            on every load so the eight facility dots always land on intentional
            grid intersections, never on a river. */}
        <g clipPath="url(#panelClip)">
          <rect x="0" y="0" width="400" height="400" fill="#0E141B" />

          {/* Stylized street grid */}
          <g aria-hidden="true">
            {/* Major arterials — slightly brighter, thicker */}
            <line x1="0" y1="140" x2="400" y2="140" stroke="#1F2731" strokeWidth="2" />
            <line x1="0" y1="260" x2="400" y2="260" stroke="#1F2731" strokeWidth="2" />
            <line x1="140" y1="0" x2="140" y2="400" stroke="#1F2731" strokeWidth="2" />
            <line x1="260" y1="0" x2="260" y2="400" stroke="#1F2731" strokeWidth="2" />

            {/* Secondary streets — thinner, dimmer */}
            <line x1="0" y1="70" x2="400" y2="70" stroke="#181F27" strokeWidth="1.25" />
            <line x1="0" y1="330" x2="400" y2="330" stroke="#181F27" strokeWidth="1.25" />
            <line x1="70" y1="0" x2="70" y2="400" stroke="#181F27" strokeWidth="1.25" />
            <line x1="330" y1="0" x2="330" y2="400" stroke="#181F27" strokeWidth="1.25" />

            {/* A diagonal cross-street for visual variety */}
            <line x1="-20" y1="-20" x2="420" y2="420" stroke="#141A22" strokeWidth="1" opacity="0.55" />
            <line x1="420" y1="-20" x2="-20" y2="420" stroke="#141A22" strokeWidth="1" opacity="0.55" />

            {/* Subtle building blocks scattered in the corners */}
            <rect x="22" y="22" width="36" height="36" rx="2" fill="#141B23" />
            <rect x="22" y="80" width="36" height="42" rx="2" fill="#131A22" />
            <rect x="342" y="22" width="36" height="36" rx="2" fill="#141B23" />
            <rect x="342" y="80" width="36" height="42" rx="2" fill="#131A22" />
            <rect x="22" y="342" width="36" height="36" rx="2" fill="#141B23" />
            <rect x="22" y="278" width="36" height="42" rx="2" fill="#131A22" />
            <rect x="342" y="342" width="36" height="36" rx="2" fill="#141B23" />
            <rect x="342" y="278" width="36" height="42" rx="2" fill="#131A22" />
            <rect x="155" y="22" width="60" height="36" rx="2" fill="#141B23" />
            <rect x="220" y="22" width="32" height="36" rx="2" fill="#131A22" />
            <rect x="155" y="342" width="32" height="36" rx="2" fill="#131A22" />
            <rect x="218" y="342" width="58" height="36" rx="2" fill="#141B23" />
          </g>

          {/* Inner vignette so the heart's lit pool reads against shaded edges */}
          <rect
            x="0"
            y="0"
            width="400"
            height="400"
            fill="url(#panelVignette)"
            pointerEvents="none"
          />
        </g>

        {/* Panel hairline — sells the "lit panel" floating-card cue */}
        <rect
          x="0.5"
          y="0.5"
          width="399"
          height="399"
          rx="21.5"
          ry="21.5"
          fill="none"
          stroke="rgba(232,134,74,0.18)"
          strokeWidth="1"
        />

        {/* Continuous ripple rings — the platform radiating outward. Three
            staggered rings expand from the heart and fade as they reach the
            panel edge, on a long repeat for ambient motion. */}
        {!reduce &&
          [0, 1, 2].map((i) => (
            <motion.circle
              key={`ripple-${i}`}
              cx={center.x}
              cy={center.y}
              fill="none"
              stroke="#E8864A"
              strokeWidth={1.2}
              initial={{ r: 20, opacity: 0 }}
              animate={{ r: 195, opacity: [0, 0.55, 0] }}
              transition={{
                duration: 4.5,
                repeat: Infinity,
                delay: 1.5 + i * 1.5,
                ease: "easeOut",
                times: [0, 0.18, 1],
              }}
            />
          ))}

        {/* Connecting spokes */}
        {dots.map((d, i) => {
          const delay = baseDelay + i * step;
          const dx = d.x - center.x;
          const dy = d.y - center.y;
          const len = Math.hypot(dx, dy);
          const startTrim = 36;
          const endTrim = 9;
          const sx = center.x + (dx / len) * startTrim;
          const sy = center.y + (dy / len) * startTrim;
          const ex = d.x - (dx / len) * endTrim;
          const ey = d.y - (dy / len) * endTrim;
          const dash = Math.hypot(ex - sx, ey - sy);
          return (
            <motion.line
              key={`spoke-${i}`}
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke="#E8864A"
              strokeOpacity={0.95}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={dash}
              initial={{ strokeDashoffset: dash }}
              animate={
                reveal ? { strokeDashoffset: 0 } : { strokeDashoffset: dash }
              }
              transition={{
                duration: reduce ? 0.001 : 0.4,
                delay,
                ease: "easeOut",
              }}
            />
          );
        })}

        {/* Heart halo */}
        <circle cx={center.x} cy={center.y} r={72} fill="url(#heartGlow)" />

        {/* Heart entrance + breathing loop */}
        <motion.g
          initial={false}
          animate={
            reveal && !reduce
              ? { scale: [1, 1.07, 1, 1.05, 1] }
              : { scale: 1 }
          }
          transition={
            reveal && !reduce
              ? {
                  duration: 1.6,
                  delay: 2.4,
                  repeat: Infinity,
                  repeatDelay: 1.0,
                  ease: "easeInOut",
                  times: [0, 0.18, 0.36, 0.54, 1],
                }
              : { duration: 0 }
          }
          style={{ transformOrigin: `${center.x}px ${center.y}px` }}
        >
          <motion.g
            initial={{ scale: 0, opacity: 0 }}
            animate={
              reveal
                ? { scale: [0, 1.2, 1], opacity: 1 }
                : { scale: 0, opacity: 0 }
            }
            transition={{
              duration: reduce ? 0.001 : 0.75,
              delay: reduce ? 0 : 0.15,
              times: [0, 0.65, 1],
              ease: "easeOut",
            }}
            style={{ transformOrigin: `${center.x}px ${center.y}px` }}
          >
            <BrandHeart cx={center.x} cy={center.y} />
          </motion.g>
        </motion.g>

        {/* Facility dots */}
        {dots.map((d, i) => {
          const delay = baseDelay + i * step + 0.2;
          return (
            <motion.g
              key={`dot-${i}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={
                reveal ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
              }
              transition={{
                duration: reduce ? 0.001 : 0.35,
                delay,
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

        {/* Inbound particle stream — small lights travel from each facility
            point toward the heart. Visualizes "connections flowing back to
            the platform." Loops continuously after the entrance settles. */}
        {!reduce &&
          reveal &&
          dots.map((d, i) => {
            // Particle starts ~15% out from the dot and dies ~15% from the heart.
            const dx = center.x - d.x;
            const dy = center.y - d.y;
            const startX = d.x + dx * 0.15;
            const startY = d.y + dy * 0.15;
            const endX = d.x + dx * 0.82;
            const endY = d.y + dy * 0.82;
            return (
              <motion.circle
                key={`particle-${i}`}
                r={2}
                fill="#FFD7B0"
                initial={{ cx: startX, cy: startY, opacity: 0 }}
                animate={{
                  cx: [startX, endX],
                  cy: [startY, endY],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 2.4,
                  delay: 3.0 + i * 0.32,
                  repeat: Infinity,
                  repeatDelay: 2.6,
                  ease: "easeIn",
                  times: [0, 0.18, 0.78, 1],
                }}
              />
            );
          })}
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
      className={`relative border-t border-white/5 ${
        surface === "elev" ? "bg-[#0F1419]" : "bg-[#0A0E13]"
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
            <p className="portal-eyebrow text-[#FFB07A]">Our mission</p>
          </FadeUp>
          <FadeUp>
            <h2
              className="mt-4 font-bold leading-tight"
              style={{ fontSize: "clamp(1.875rem, 3.3vw, 2.75rem)" }}
            >
              <span className="text-[#F5EFE7]">
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

          <div className="mt-12 space-y-6 text-lg text-[#A8B0BA] leading-relaxed max-w-2xl mx-auto">
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
              <p className="text-[#FFB07A] font-semibold">
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
              <p className="portal-eyebrow text-[#FFB07A]">For caregivers</p>
            </FadeUp>
            <FadeUp>
              <h2
                className="mt-3 font-bold text-[#F5EFE7] leading-tight"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
              >
                Your work changes lives.
                <br />
                <span className="text-[#FFB07A]">
                  Your career should change too.
                </span>
              </h2>
            </FadeUp>
            <FadeUp>
              <p className="mt-6 text-lg text-[#A8B0BA] leading-relaxed">
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
              <p className="portal-eyebrow text-[#FFB07A]">
                For facility operators
              </p>
            </FadeUp>
            <FadeUp>
              <h2
                className="mt-3 font-bold text-[#F5EFE7] leading-tight"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
              >
                You opened your home to
                <br />
                <span className="text-[#FFB07A]">
                  other people&rsquo;s parents,
                </span>
                <br />
                siblings, and children.
              </h2>
            </FadeUp>
            <FadeUp>
              <p className="mt-6 text-lg text-[#A8B0BA] leading-relaxed">
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
        className="relative h-full rounded-3xl overflow-hidden border border-white/10"
        style={{
          background:
            "linear-gradient(160deg, rgba(28,36,46,0.85) 0%, rgba(15,20,25,0.7) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.08), 0 30px 60px -25px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,176,122,0.05)",
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
            <p className="mt-7 text-2xl font-black text-[#F5EFE7] leading-tight">
              {quote}
            </p>
            <p className="mt-4 text-sm text-[#A8B0BA]">{caption}</p>
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
      className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5EFE7] bg-gradient-to-br from-[#E8864A] to-[#C25A2E] hover:from-[#F09659] hover:to-[#D4693A] px-5 py-3 rounded-xl transition-colors shadow-[0_0_0_1px_rgba(255,176,122,0.3),0_10px_24px_-10px_rgba(232,134,74,0.6)]"
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
            <p className="portal-eyebrow text-[#FFB07A]">The standard</p>
          </FadeUp>
          <FadeUp className="max-w-3xl">
            <h2
              className="mt-3 font-bold text-[#F5EFE7] leading-tight"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
            >
              The residential care industry doesn&rsquo;t need another vendor.
              <br />
              <span className="text-[#FFB07A]">It needs a standard.</span>
            </h2>
          </FadeUp>
          <FadeUp className="max-w-3xl">
            <p className="mt-6 text-lg text-[#A8B0BA] leading-relaxed">
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
        className="relative h-full rounded-2xl p-6 border border-white/10 group-hover:border-[rgba(232,134,74,0.4)] transition-colors overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, rgba(28,36,46,0.85) 0%, rgba(15,20,25,0.7) 100%)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.06), 0 20px 40px -20px rgba(0,0,0,0.6)",
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
          className="relative mt-5 text-lg font-bold text-[#F5EFE7]"
          style={{ transform: "translateZ(16px)" }}
        >
          {title}
        </h3>
        <p
          className="relative mt-2 text-sm text-[#A8B0BA] leading-relaxed"
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
            <p className="portal-eyebrow text-[#FFB07A]">
              Why both sides matter
            </p>
          </FadeUp>
          <FadeUp>
            <h2
              className="mt-3 font-bold leading-tight"
              style={{ fontSize: "clamp(1.875rem, 3.3vw, 2.75rem)" }}
            >
              <span className="text-[#F5EFE7]">
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
            <p className="mt-8 text-lg text-[#A8B0BA] leading-relaxed max-w-2xl mx-auto">
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
            <div className="mt-10 inline-flex items-center gap-3 px-5 py-3 rounded-full bg-[rgba(232,134,74,0.1)] text-[#FFB07A] border border-[rgba(232,134,74,0.3)]">
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
              duration: 3,
              repeat: Infinity,
              delay,
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
          duration: 1.6,
          repeat: Infinity,
          repeatDelay: 0.8,
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
            <p className="mt-5 text-lg text-[#A8B0BA] max-w-xl mx-auto leading-relaxed">
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
    <footer className="border-t border-white/5 bg-[#0A0E13]">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandLogo size={80} />
        </div>
        <div className="text-xs text-[#6B7480] text-left sm:text-right space-y-1.5 leading-relaxed">
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
              className="hover:text-[#A8B0BA] transition-colors underline-offset-2 hover:underline"
            >
              OpenStreetMap
            </a>{" "}
            contributors, ©{" "}
            <a
              href="https://carto.com/attributions"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#A8B0BA] transition-colors underline-offset-2 hover:underline"
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
        <p className="font-semibold text-[#F5EFE7] group-hover:text-[#FFB07A] transition-colors">
          {title}
        </p>
        <p className="mt-1 text-sm text-[#A8B0BA] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
