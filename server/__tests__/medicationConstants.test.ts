import { describe, expect, it } from "vitest";
import {
  parseLegacyFrequency,
  parseLegacyScheduledTimes,
  joinScheduledTimes,
  isKnownFrequency,
  frequencyLabel,
  defaultScheduledTimes,
  validateFrequencyTimesConsistency,
  normalizeMedicationRow,
  MedicationCreateInput,
  MedicationUpdateInput,
  HH_MM,
} from "@shared/medication-constants";

describe("parseLegacyFrequency", () => {
  it("returns canonical values unchanged", () => {
    expect(parseLegacyFrequency("once_daily")).toBe("once_daily");
    expect(parseLegacyFrequency("prn")).toBe("prn");
  });

  it("maps common free-text aliases case-insensitively", () => {
    expect(parseLegacyFrequency("Once daily")).toBe("once_daily");
    expect(parseLegacyFrequency("BID")).toBe("twice_daily");
    expect(parseLegacyFrequency("twice a day")).toBe("twice_daily");
    expect(parseLegacyFrequency("TID")).toBe("three_times_daily");
    expect(parseLegacyFrequency("QID")).toBe("four_times_daily");
    expect(parseLegacyFrequency("q6h")).toBe("every_6_hours");
    expect(parseLegacyFrequency("HS")).toBe("at_bedtime");
    expect(parseLegacyFrequency("AM")).toBe("in_the_morning");
    expect(parseLegacyFrequency("as needed")).toBe("prn");
    expect(parseLegacyFrequency("PRN")).toBe("prn");
  });

  it("strips punctuation variants", () => {
    expect(parseLegacyFrequency("b.i.d.")).toBe("twice_daily");
    expect(parseLegacyFrequency("p.r.n.")).toBe("prn");
  });

  it("falls through to 'other' for unrecognized text", () => {
    expect(parseLegacyFrequency("TID with food")).toBe("other");
    expect(parseLegacyFrequency("every other day")).toBe("other");
    expect(parseLegacyFrequency("")).toBe("other");
    expect(parseLegacyFrequency(null)).toBe("other");
    expect(parseLegacyFrequency(undefined)).toBe("other");
  });
});

describe("parseLegacyScheduledTimes", () => {
  it("splits and trims comma-joined CSV", () => {
    expect(parseLegacyScheduledTimes("08:00, 20:00")).toEqual(["08:00", "20:00"]);
    expect(parseLegacyScheduledTimes("08:00,20:00,")).toEqual(["08:00", "20:00"]);
  });

  it("filters out malformed entries", () => {
    expect(parseLegacyScheduledTimes("08:00, 8AM, 20:00")).toEqual(["08:00", "20:00"]);
    expect(parseLegacyScheduledTimes("garbage")).toEqual([]);
    expect(parseLegacyScheduledTimes("25:00, 08:60")).toEqual([]);
  });

  it("returns [] for null/empty", () => {
    expect(parseLegacyScheduledTimes(null)).toEqual([]);
    expect(parseLegacyScheduledTimes("")).toEqual([]);
    expect(parseLegacyScheduledTimes(undefined)).toEqual([]);
  });
});

describe("joinScheduledTimes", () => {
  it("returns null for empty array", () => {
    expect(joinScheduledTimes([])).toBeNull();
    expect(joinScheduledTimes(null)).toBeNull();
  });

  it("comma-joins without spaces", () => {
    expect(joinScheduledTimes(["08:00", "20:00"])).toBe("08:00,20:00");
  });
});

describe("isKnownFrequency / frequencyLabel / defaultScheduledTimes", () => {
  it("recognizes canonical values", () => {
    expect(isKnownFrequency("twice_daily")).toBe(true);
    expect(isKnownFrequency("BID")).toBe(false);
    expect(isKnownFrequency(undefined)).toBe(false);
  });

  it("maps canonical values to labels", () => {
    expect(frequencyLabel("twice_daily")).toBe("Twice daily (BID)");
    expect(frequencyLabel("prn")).toBe("As needed (PRN)");
    expect(frequencyLabel(null)).toBe("");
  });

  it("provides default times by frequency", () => {
    expect(defaultScheduledTimes("twice_daily")).toEqual(["09:00", "21:00"]);
    expect(defaultScheduledTimes("prn")).toEqual([]);
  });
});

describe("HH_MM regex", () => {
  it("accepts valid 24-hour times", () => {
    expect(HH_MM.test("00:00")).toBe(true);
    expect(HH_MM.test("23:59")).toBe(true);
    expect(HH_MM.test("08:30")).toBe(true);
  });

  it("rejects invalid times", () => {
    expect(HH_MM.test("24:00")).toBe(false);
    expect(HH_MM.test("08:60")).toBe(false);
    expect(HH_MM.test("8:00")).toBe(false);
    expect(HH_MM.test("8AM")).toBe(false);
  });
});

describe("validateFrequencyTimesConsistency", () => {
  it("rejects PRN with scheduled times", () => {
    const r = validateFrequencyTimesConsistency("prn", ["08:00"]);
    expect(r.ok).toBe(false);
  });

  it("rejects scheduled frequency with empty times", () => {
    const r = validateFrequencyTimesConsistency("twice_daily", []);
    expect(r.ok).toBe(false);
  });

  it("allows PRN with empty times", () => {
    expect(validateFrequencyTimesConsistency("prn", []).ok).toBe(true);
  });

  it("allows other with any times (legacy escape hatch)", () => {
    expect(validateFrequencyTimesConsistency("other", []).ok).toBe(true);
    expect(validateFrequencyTimesConsistency("other", ["08:00"]).ok).toBe(true);
  });

  it("allows scheduled frequency with one or more times", () => {
    expect(validateFrequencyTimesConsistency("twice_daily", ["09:00", "21:00"]).ok).toBe(true);
  });
});

describe("MedicationCreateInput", () => {
  const base = { drugName: "Lisinopril", dosage: "10 mg", route: "oral" };

  it("accepts a canonical payload", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "twice_daily",
      scheduledTimes: ["08:00", "20:00"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.frequency).toBe("twice_daily");
      expect(r.data.scheduledTimes).toEqual(["08:00", "20:00"]);
    }
  });

  it("normalizes a legacy free-text frequency", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "BID",
      scheduledTimes: ["08:00", "20:00"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.frequency).toBe("twice_daily");
  });

  it("normalizes a legacy CSV scheduledTimes", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "twice_daily",
      scheduledTimes: "08:00, 20:00",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scheduledTimes).toEqual(["08:00", "20:00"]);
  });

  it("sorts scheduled times ascending", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "twice_daily",
      scheduledTimes: ["20:00", "08:00"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scheduledTimes).toEqual(["08:00", "20:00"]);
  });

  it("rejects PRN with scheduled times", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "prn",
      scheduledTimes: ["08:00"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-PRN with empty scheduled times", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "twice_daily",
      scheduledTimes: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts PRN with no scheduled times", () => {
    const r = MedicationCreateInput.safeParse({
      ...base,
      frequency: "prn",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scheduledTimes).toEqual([]);
  });

  it("rejects missing required fields", () => {
    expect(MedicationCreateInput.safeParse({ frequency: "prn" }).success).toBe(false);
    expect(MedicationCreateInput.safeParse({ ...base, frequency: "prn", drugName: "" }).success).toBe(false);
  });
});

describe("MedicationUpdateInput", () => {
  it("accepts a partial patch", () => {
    expect(MedicationUpdateInput.safeParse({ dosage: "20 mg" }).success).toBe(true);
  });

  it("normalizes a legacy frequency in a patch", () => {
    const r = MedicationUpdateInput.safeParse({ frequency: "TID" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.frequency).toBe("three_times_daily");
  });
});

describe("normalizeMedicationRow", () => {
  it("adds canonical fields without losing original", () => {
    const row = {
      id: 1,
      frequency: "BID",
      scheduledTimes: "08:00, 20:00",
      drugName: "Lisinopril",
    };
    const out = normalizeMedicationRow(row);
    expect(out.frequency).toBe("twice_daily");
    expect(out.frequencyLabel).toBe("Twice daily (BID)");
    expect(out.frequencyRaw).toBe("BID");
    expect(out.scheduledTimesArray).toEqual(["08:00", "20:00"]);
    expect(out.drugName).toBe("Lisinopril");
  });

  it("leaves frequencyRaw null for already-canonical rows", () => {
    const row = { frequency: "twice_daily", scheduledTimes: "08:00,20:00" };
    const out = normalizeMedicationRow(row);
    expect(out.frequencyRaw).toBeNull();
  });

  it("handles null scheduledTimes", () => {
    const out = normalizeMedicationRow({ frequency: "prn", scheduledTimes: null });
    expect(out.scheduledTimesArray).toEqual([]);
  });
});
