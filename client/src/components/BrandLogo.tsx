export function BrandLogo({ size = 52 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 4 120 76"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
        style={{ height: "auto" }}
      >
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
        <path d="M60 32 C60 28, 54 24, 51 28 C48 32, 53 37, 60 44 C67 37, 72 32, 69 28 C66 24, 60 28, 60 32Z" fill="#D4693A"/>
        <circle cx="60" cy="8" r="5" fill="#D4693A"/>
        <circle cx="60" cy="6.5" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="82.8" cy="17.2" r="5" fill="#E8864A"/>
        <circle cx="82.8" cy="15.7" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="92" cy="40" r="5" fill="#C25A2E"/>
        <circle cx="92" cy="38.5" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="82.8" cy="62.8" r="5" fill="#D4693A"/>
        <circle cx="82.8" cy="61.3" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="60" cy="72" r="5" fill="#E8864A"/>
        <circle cx="60" cy="70.5" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="37.2" cy="62.8" r="5" fill="#C25A2E"/>
        <circle cx="37.2" cy="61.3" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="28" cy="40" r="5" fill="#D4693A"/>
        <circle cx="28" cy="38.5" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="37.2" cy="17.2" r="5" fill="#E8864A"/>
        <circle cx="37.2" cy="15.7" r="1.5" fill="white" opacity="0.5"/>
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-[10px] font-bold tracking-[2.5px] uppercase text-brand-primary">
          Neighbourhood
        </span>
        <span className="text-[28px] font-black text-brand-primary-dark leading-tight">
          Care
        </span>
        <span className="text-[10px] font-bold tracking-[2.5px] uppercase text-brand-primary">
          Finder
        </span>
      </div>
    </div>
  );
}
