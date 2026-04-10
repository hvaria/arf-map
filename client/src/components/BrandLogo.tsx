export function BrandLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="40" height="40" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
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
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontFamily: "'Nunito', sans-serif", fontSize: 8, fontWeight: 600, color: "#D4693A", letterSpacing: "2.5px", textTransform: "uppercase" }}>NEIGHBOURHOOD</span>
        <span style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, color: "#B8532A", lineHeight: 1.05 }}>Care</span>
        <span style={{ fontFamily: "'Nunito', sans-serif", fontSize: 8, fontWeight: 600, color: "#D4693A", letterSpacing: "2.5px", textTransform: "uppercase" }}>FINDER</span>
      </div>
    </div>
  );
}
