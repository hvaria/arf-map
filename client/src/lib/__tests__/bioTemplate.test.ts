import { describe, expect, it } from "vitest";
import { buildBio } from "../bioTemplate";

// buildBio is a pure assembler — tests cover the 5 yearsExperience
// branches plus the null-zipCity branch plus the 0/1/2/3-credential cases.
// Two canonical strings from the architect's plan are pinned verbatim.

describe("buildBio — reference outputs (architect plan)", () => {
  it("matches the CNA + First Aid + ZIP 94110 example", () => {
    const out = buildBio({
      credentials: ["CNA", "FIRST_AID"],
      yearsExperience: 3,
      zipCity: "94110",
    });
    expect(out).toBe(
      "CNA and First Aid certified caregiver, with 3 years of hands-on experience, based in ZIP 94110. " +
        "Available for caregiver and direct support roles at ARFs, RCFEs, and group homes nearby.",
    );
  });

  it("matches the RCFE/Live Scan/TB + new + Oakland example", () => {
    // The "verified" connective in the plan's second illustration is
    // explicitly noted as illustrative — the implementation uses the
    // single "certified caregiver" connective from the first reference.
    const out = buildBio({
      credentials: ["RCFE_40_HOUR", "LIVE_SCAN", "TB"],
      yearsExperience: null,
      zipCity: "Oakland, CA",
    });
    expect(out).toBe(
      "RCFE 40-hr Training, Live Scan Clearance and TB Clearance certified caregiver, new to professional care work, based in Oakland, CA. " +
        "Available for caregiver and direct support roles at ARFs, RCFEs, and group homes nearby.",
    );
  });
});

describe("buildBio — yearsExperience branches", () => {
  const base = { credentials: ["CNA"] as const, zipCity: "94110" };

  it("null → 'new to professional care work'", () => {
    const out = buildBio({ ...base, yearsExperience: null, credentials: [...base.credentials] });
    expect(out).toContain("new to professional care work");
  });

  it("0 → 'starting my career in care'", () => {
    const out = buildBio({ ...base, yearsExperience: 0, credentials: [...base.credentials] });
    expect(out).toContain("starting my career in care");
  });

  it("1 → 'with 1 year of hands-on experience'", () => {
    const out = buildBio({ ...base, yearsExperience: 1, credentials: [...base.credentials] });
    expect(out).toContain("with 1 year of hands-on experience");
  });

  it("3 (mid-bucket) → 'with 3 years of hands-on experience'", () => {
    const out = buildBio({ ...base, yearsExperience: 3, credentials: [...base.credentials] });
    expect(out).toContain("with 3 years of hands-on experience");
  });

  it(">= 5 → 'with 5+ years of hands-on experience'", () => {
    const out = buildBio({ ...base, yearsExperience: 5, credentials: [...base.credentials] });
    expect(out).toContain("with 5+ years of hands-on experience");
    const tenYears = buildBio({ ...base, yearsExperience: 10, credentials: [...base.credentials] });
    expect(tenYears).toContain("with 5+ years of hands-on experience");
  });
});

describe("buildBio — credential-count branches", () => {
  it("0 credentials → opener is 'Caregiver'", () => {
    const out = buildBio({ credentials: [], yearsExperience: 1, zipCity: "94110" });
    expect(out.startsWith("Caregiver, ")).toBe(true);
  });

  it("1 credential → no 'and' in the opener", () => {
    const out = buildBio({ credentials: ["CNA"], yearsExperience: 1, zipCity: "94110" });
    expect(out.startsWith("CNA certified caregiver,")).toBe(true);
  });

  it("2 credentials → joined with ' and '", () => {
    const out = buildBio({
      credentials: ["CNA", "LVN"],
      yearsExperience: 1,
      zipCity: "94110",
    });
    expect(out.startsWith("CNA and LVN certified caregiver,")).toBe(true);
  });

  it("3 credentials → comma list with terminal ' and '", () => {
    const out = buildBio({
      credentials: ["CNA", "LVN", "TB"],
      yearsExperience: 1,
      zipCity: "94110",
    });
    expect(out.startsWith("CNA, LVN and TB Clearance certified caregiver,")).toBe(true);
  });

  it("more than 3 credentials → only the first 3 appear in the opener", () => {
    const out = buildBio({
      credentials: ["CNA", "LVN", "RN", "TB", "CPR"],
      yearsExperience: 1,
      zipCity: "94110",
    });
    expect(out.startsWith("CNA, LVN and RN certified caregiver,")).toBe(true);
    expect(out).not.toContain("TB Clearance");
  });
});

describe("buildBio — location branches", () => {
  it("null zipCity → location clause omitted", () => {
    const out = buildBio({ credentials: ["CNA"], yearsExperience: 1, zipCity: null });
    expect(out).not.toContain("based in");
    // sentence should still terminate cleanly with the closing line
    expect(out).toBe(
      "CNA certified caregiver, with 1 year of hands-on experience. " +
        "Available for caregiver and direct support roles at ARFs, RCFEs, and group homes nearby.",
    );
  });

  it("non-ZIP string → 'based in {string}'", () => {
    const out = buildBio({
      credentials: ["CNA"],
      yearsExperience: 1,
      zipCity: "San Francisco, CA",
    });
    expect(out).toContain("based in San Francisco, CA");
  });
});
