export function BrandLogo({ size = 52 }: { size?: number }) {
  // `size` is the total visual height of the brand block. The SVG fills
  // that height and the wordmark scales proportionally so the mark and
  // the words always read as a balanced pair (no short-logo / tall-text
  // mismatch).
  const scale = size / 55;
  const smallPx = 10 * scale;
  const carePx = 28 * scale;
  const trackingPx = 2.5 * scale;

  return (
    <span className="inline-flex items-center gap-2.5 transition-transform duration-200 hover:scale-[1.02]">
      <svg
        viewBox="0 4 120 76"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
        className="flex-shrink-0"
        style={{
          height: `${size}px`,
          width: "auto",
          filter:
            "drop-shadow(0 2px 3px rgba(196, 90, 46, 0.22)) drop-shadow(0 1px 1px rgba(15, 23, 42, 0.08))",
        }}
      >
        <defs>
          <filter id="bl-bevel" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.6" result="blur"/>
            <feSpecularLighting in="blur" surfaceScale="1.2" specularConstant="0.35" specularExponent="20" lightingColor="#ffffff" result="spec">
              <feDistantLight azimuth="135" elevation="60"/>
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceGraphic" operator="in" result="specOnShape"/>
            <feMerge>
              <feMergeNode in="SourceGraphic"/>
              <feMergeNode in="specOnShape"/>
            </feMerge>
          </filter>
        </defs>
        <line x1="60" y1="8" x2="60" y2="48" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="82.8" y1="17.2" x2="67" y2="43" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="92" y1="40" x2="72" y2="48" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="82.8" y1="62.8" x2="67" y2="55" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="60" y1="72" x2="60" y2="56" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="37.2" y1="62.8" x2="53" y2="55" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="28" y1="40" x2="48" y2="48" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <line x1="37.2" y1="17.2" x2="53" y2="43" stroke="#E8864A" strokeWidth="1.5" opacity="0.35"/>
        <circle cx="60" cy="40" r="32" fill="none" stroke="#E8864A" strokeWidth="0.8" opacity="0.15"/>
        <circle cx="60" cy="40" r="12" fill="#E8864A" opacity="0.1"/>
        <g filter="url(#bl-bevel)">
          <path d="M60 32 C60 28, 54 24, 51 28 C48 32, 53 37, 60 44 C67 37, 72 32, 69 28 C66 24, 60 28, 60 32Z" fill="#D4693A"/>
          <circle cx="60" cy="8" r="5" fill="#D4693A"/>
          <circle cx="82.8" cy="17.2" r="5" fill="#E8864A"/>
          <circle cx="92" cy="40" r="5" fill="#C25A2E"/>
          <circle cx="82.8" cy="62.8" r="5" fill="#D4693A"/>
          <circle cx="60" cy="72" r="5" fill="#E8864A"/>
          <circle cx="37.2" cy="62.8" r="5" fill="#C25A2E"/>
          <circle cx="28" cy="40" r="5" fill="#D4693A"/>
          <circle cx="37.2" cy="17.2" r="5" fill="#E8864A"/>
        </g>
        <circle cx="60" cy="6.5" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="82.8" cy="15.7" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="92" cy="38.5" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="82.8" cy="61.3" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="60" cy="70.5" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="37.2" cy="61.3" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="28" cy="38.5" r="1.2" fill="white" opacity="0.7"/>
        <circle cx="37.2" cy="15.7" r="1.2" fill="white" opacity="0.7"/>
      </svg>
      <span className="inline-flex flex-col leading-none">
        <span
          className="font-bold uppercase text-brand-primary"
          style={{ fontSize: `${smallPx}px`, letterSpacing: `${trackingPx}px` }}
        >
          Neighbourhood
        </span>
        <span
          className="font-black text-brand-primary-dark leading-tight"
          style={{ fontSize: `${carePx}px` }}
        >
          Care
        </span>
        <span
          className="font-bold uppercase text-brand-primary"
          style={{ fontSize: `${smallPx}px`, letterSpacing: `${trackingPx}px` }}
        >
          Finder
        </span>
      </span>
    </span>
  );
}
