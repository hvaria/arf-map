/**
 * FacilityAvatar smoke tests.
 *
 * Covers the two render branches (image vs. deterministic initials fallback)
 * and the initials-derivation rule (skip joiner words, single-word names get
 * one letter, multi-word names use first + last significant word).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  FacilityAvatar,
  facilityInitials,
} from "../components/facility/FacilityAvatar";

afterEach(() => cleanup());

describe("FacilityAvatar", () => {
  it("renders an img element when logoUrl is set with the facility name as alt", () => {
    const facilityName = "DAVID & TERRIE'S HOME";
    const logoUrl = "/api/facility/profile/logo?t=123";
    render(<FacilityAvatar logoUrl={logoUrl} facilityName={facilityName} />);
    const img = screen.getByRole("img", { name: facilityName });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe(logoUrl);
  });

  it("renders the initials fallback when logoUrl is null", () => {
    const facilityName = "DAVID & TERRIE'S HOME";
    render(<FacilityAvatar logoUrl={null} facilityName={facilityName} />);
    const fallback = screen.getByTestId("facility-avatar-initials");
    expect(fallback).toBeInTheDocument();
    expect(fallback.textContent).toBe("DT");
    // Decorative — must be hidden from AT.
    expect(fallback.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("facilityInitials", () => {
  it("returns DT for 'DAVID & TERRIE'S HOME' (skips & joiner, takes first + last significant word)", () => {
    expect(facilityInitials("DAVID & TERRIE'S HOME")).toBe("DT");
  });

  it("skips joiner words like '&' and 'and'", () => {
    expect(facilityInitials("ABC & XYZ")).toBe("AX");
    expect(facilityInitials("ABC and XYZ")).toBe("AX");
    expect(facilityInitials("Heart of the City")).toBe("HC");
  });

  it("returns the first letter for a single-word name", () => {
    expect(facilityInitials("SUNSHINE")).toBe("S");
  });

  it("returns an uppercase pair for two-word names regardless of input casing", () => {
    expect(facilityInitials("abc pharmacy")).toBe("AP");
  });

  it("returns empty string for an empty / whitespace-only name", () => {
    expect(facilityInitials("")).toBe("");
    expect(facilityInitials("   ")).toBe("");
  });
});
