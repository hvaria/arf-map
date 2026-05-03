import { describe, expect, it } from "vitest";
import {
  canAcknowledgeNote,
  canArchiveNote,
  canCreateNote,
  canDeleteNote,
  canEditNote,
  canReplyToNote,
  canViewNote,
  type NoteRole,
  type NoteViewerContext,
} from "../ops/notePolicy";
import type { OpsNote } from "../ops/notesSchema";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures — minimal builders so each test reads as policy intent only.
// ─────────────────────────────────────────────────────────────────────────────

const FACILITY_A = "F-001";
const FACILITY_B = "F-002";
const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms
const MIN = 60 * 1000;

function viewer(
  partial: Partial<NoteViewerContext> & { role: NoteRole; facilityAccountId: number },
): NoteViewerContext {
  return {
    facilityNumber: FACILITY_A,
    staffId: null,
    displayName: "Test User",
    assignedResidentIds: [],
    ...partial,
  };
}

function note(partial: Partial<OpsNote> = {}): OpsNote {
  return {
    id: 1,
    facilityNumber: FACILITY_A,
    parentNoteId: null,
    category: "general",
    residentId: null,
    shiftId: null,
    title: null,
    body: "test body",
    visibilityScope: "facility_wide",
    priority: "normal",
    status: "open",
    ackRequired: 0,
    ackRequiredRole: null,
    followUpBy: null,
    effectiveUntil: null,
    isQuick: 0,
    authorFacilityAccountId: 100,
    authorStaffId: null,
    authorDisplayName: "Author",
    authorRole: "caregiver",
    editCount: 0,
    lastEditedAt: null,
    lastEditedByAccountId: null,
    archivedAt: null,
    archivedByAccountId: null,
    deletedAt: null,
    deletedByAccountId: null,
    createdAt: NOW - 60 * MIN,
    updatedAt: NOW - 60 * MIN,
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// canViewNote
// ─────────────────────────────────────────────────────────────────────────────

describe("canViewNote", () => {
  it("denies cross-facility access for any role", () => {
    const n = note({ facilityNumber: FACILITY_B });
    for (const role of [
      "facility_admin",
      "supervisor",
      "med_tech",
      "caregiver",
      "compliance_reviewer",
      "provider",
    ] as NoteRole[]) {
      const v = viewer({ role, facilityAccountId: 1 });
      expect(canViewNote(v, n), `role=${role}`).toBe(false);
    }
  });

  it("allows facility_wide notes to any same-facility staff", () => {
    const n = note({ visibilityScope: "facility_wide" });
    expect(canViewNote(viewer({ role: "caregiver", facilityAccountId: 1 }), n)).toBe(true);
    expect(canViewNote(viewer({ role: "supervisor", facilityAccountId: 1 }), n)).toBe(true);
  });

  it("hides admin_only notes from caregivers and med_techs", () => {
    const n = note({ visibilityScope: "admin_only" });
    expect(canViewNote(viewer({ role: "caregiver", facilityAccountId: 1 }), n)).toBe(false);
    expect(canViewNote(viewer({ role: "med_tech", facilityAccountId: 1 }), n)).toBe(false);
  });

  it("shows admin_only notes to supervisors and admins", () => {
    const n = note({ visibilityScope: "admin_only" });
    expect(canViewNote(viewer({ role: "supervisor", facilityAccountId: 1 }), n)).toBe(true);
    expect(canViewNote(viewer({ role: "facility_admin", facilityAccountId: 1 }), n)).toBe(true);
  });

  it("shows resident_specific notes to assigned caregivers", () => {
    const n = note({ visibilityScope: "resident_specific", residentId: 42 });
    const v = viewer({
      role: "caregiver",
      facilityAccountId: 1,
      assignedResidentIds: [42, 43],
    });
    expect(canViewNote(v, n)).toBe(true);
  });

  it("hides resident_specific notes from un-assigned caregivers", () => {
    const n = note({ visibilityScope: "resident_specific", residentId: 42 });
    const v = viewer({
      role: "caregiver",
      facilityAccountId: 1,
      assignedResidentIds: [99],
    });
    expect(canViewNote(v, n)).toBe(false);
  });

  it("always shows resident_specific notes to supervisors", () => {
    const n = note({ visibilityScope: "resident_specific", residentId: 42 });
    expect(
      canViewNote(viewer({ role: "supervisor", facilityAccountId: 1 }), n),
    ).toBe(true);
  });

  it("lets the author read their own note even if scope would otherwise hide it", () => {
    const n = note({
      visibilityScope: "resident_specific",
      residentId: 42,
      authorFacilityAccountId: 7,
    });
    const v = viewer({
      role: "caregiver",
      facilityAccountId: 7,
      assignedResidentIds: [], // not assigned, but is the author
    });
    expect(canViewNote(v, n)).toBe(true);
  });

  it("hides admin_only notes from compliance_reviewer (audience too tight)", () => {
    const n = note({ visibilityScope: "admin_only" });
    expect(
      canViewNote(viewer({ role: "compliance_reviewer", facilityAccountId: 1 }), n),
    ).toBe(false);
  });

  it("shows compliance notes to compliance_reviewer", () => {
    const n = note({ visibilityScope: "compliance" });
    expect(
      canViewNote(viewer({ role: "compliance_reviewer", facilityAccountId: 1 }), n),
    ).toBe(true);
  });

  it("hides soft-deleted notes from non-admin non-author", () => {
    const n = note({ deletedAt: NOW - MIN, authorFacilityAccountId: 100 });
    const v = viewer({ role: "caregiver", facilityAccountId: 1 });
    expect(canViewNote(v, n)).toBe(false);
  });

  it("shows soft-deleted notes to author (tombstone)", () => {
    const n = note({ deletedAt: NOW - MIN, authorFacilityAccountId: 7 });
    expect(
      canViewNote(viewer({ role: "caregiver", facilityAccountId: 7 }), n),
    ).toBe(true);
  });

  it("shows soft-deleted notes to facility_admin", () => {
    const n = note({ deletedAt: NOW - MIN });
    expect(
      canViewNote(viewer({ role: "facility_admin", facilityAccountId: 1 }), n),
    ).toBe(true);
  });

  it("denies on unknown visibility scope (fail-closed)", () => {
    const n = note({ visibilityScope: "totally_made_up" as never });
    expect(
      canViewNote(viewer({ role: "facility_admin", facilityAccountId: 1 }), n),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canCreateNote
// ─────────────────────────────────────────────────────────────────────────────

describe("canCreateNote", () => {
  it("blocks compliance_reviewer from creating any note", () => {
    const r = canCreateNote(
      viewer({ role: "compliance_reviewer", facilityAccountId: 1 }),
      { category: "general", visibilityScope: "facility_wide" },
    );
    expect(r.ok).toBe(false);
  });

  it("blocks caregivers from facility_announcement", () => {
    const r = canCreateNote(
      viewer({ role: "caregiver", facilityAccountId: 1 }),
      { category: "facility_announcement", visibilityScope: "facility_wide" },
    );
    expect(r.ok).toBe(false);
  });

  it("allows supervisor to post facility_announcement", () => {
    const r = canCreateNote(
      viewer({ role: "supervisor", facilityAccountId: 1 }),
      { category: "facility_announcement", visibilityScope: "facility_wide" },
    );
    expect(r.ok).toBe(true);
  });

  it("blocks caregiver from authoring care_instruction", () => {
    const r = canCreateNote(
      viewer({ role: "caregiver", facilityAccountId: 1 }),
      {
        category: "care_instruction",
        visibilityScope: "resident_specific",
        residentId: 42,
      },
    );
    expect(r.ok).toBe(false);
  });

  it("allows med_tech, supervisor, provider to author care_instruction", () => {
    for (const role of ["med_tech", "supervisor", "provider"] as NoteRole[]) {
      const r = canCreateNote(
        viewer({ role, facilityAccountId: 1 }),
        {
          category: "care_instruction",
          visibilityScope: "resident_specific",
          residentId: 42,
        },
      );
      expect(r.ok, `role=${role}`).toBe(true);
    }
  });

  it("blocks non-supervisor from setting visibility=admin_only", () => {
    const r = canCreateNote(
      viewer({ role: "med_tech", facilityAccountId: 1 }),
      { category: "general", visibilityScope: "admin_only" },
    );
    expect(r.ok).toBe(false);
  });

  it("blocks resident-required category without residentId", () => {
    const r = canCreateNote(
      viewer({ role: "supervisor", facilityAccountId: 1 }),
      { category: "behavioral_observation", visibilityScope: "resident_specific" },
    );
    expect(r.ok).toBe(false);
  });

  it("allows general note from a caregiver", () => {
    const r = canCreateNote(
      viewer({ role: "caregiver", facilityAccountId: 1 }),
      { category: "general", visibilityScope: "facility_wide" },
    );
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canEditNote
// ─────────────────────────────────────────────────────────────────────────────

describe("canEditNote", () => {
  it("lets the author edit within the 15-minute window", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - 5 * MIN });
    const r = canEditNote(viewer({ role: "caregiver", facilityAccountId: 7 }), n, NOW);
    expect(r.ok).toBe(true);
  });

  it("blocks the author after the edit window", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - 30 * MIN });
    const r = canEditNote(viewer({ role: "caregiver", facilityAccountId: 7 }), n, NOW);
    expect(r.ok).toBe(false);
  });

  it("blocks non-author non-admin", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - MIN });
    const r = canEditNote(viewer({ role: "caregiver", facilityAccountId: 99 }), n, NOW);
    expect(r.ok).toBe(false);
  });

  it("admin can edit anytime", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - 30 * 24 * 60 * MIN });
    const r = canEditNote(
      viewer({ role: "facility_admin", facilityAccountId: 1 }),
      n,
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it("blocks edits on cross-facility notes", () => {
    const n = note({ facilityNumber: FACILITY_B, authorFacilityAccountId: 7 });
    const r = canEditNote(
      viewer({ role: "facility_admin", facilityAccountId: 7, facilityNumber: FACILITY_A }),
      n,
      NOW,
    );
    expect(r.ok).toBe(false);
  });

  it("blocks edits on deleted notes", () => {
    const n = note({ deletedAt: NOW - MIN, authorFacilityAccountId: 1 });
    const r = canEditNote(
      viewer({ role: "facility_admin", facilityAccountId: 1 }),
      n,
      NOW,
    );
    expect(r.ok).toBe(false);
  });

  it("blocks compliance_reviewer from editing", () => {
    const n = note({ authorFacilityAccountId: 1, createdAt: NOW - MIN });
    const r = canEditNote(
      viewer({ role: "compliance_reviewer", facilityAccountId: 1 }),
      n,
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canDeleteNote
// ─────────────────────────────────────────────────────────────────────────────

describe("canDeleteNote", () => {
  it("admin can delete any non-deleted note", () => {
    const n = note();
    const r = canDeleteNote(viewer({ role: "facility_admin", facilityAccountId: 1 }), n, NOW);
    expect(r.ok).toBe(true);
  });

  it("author can delete within edit window", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - 5 * MIN });
    const r = canDeleteNote(viewer({ role: "caregiver", facilityAccountId: 7 }), n, NOW);
    expect(r.ok).toBe(true);
  });

  it("author cannot delete after edit window", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - 30 * MIN });
    const r = canDeleteNote(viewer({ role: "caregiver", facilityAccountId: 7 }), n, NOW);
    expect(r.ok).toBe(false);
  });

  it("non-author non-admin cannot delete", () => {
    const n = note({ authorFacilityAccountId: 7, createdAt: NOW - MIN });
    const r = canDeleteNote(viewer({ role: "supervisor", facilityAccountId: 99 }), n, NOW);
    expect(r.ok).toBe(false);
  });

  it("cannot delete already-deleted notes", () => {
    const n = note({ deletedAt: NOW - MIN });
    const r = canDeleteNote(viewer({ role: "facility_admin", facilityAccountId: 1 }), n, NOW);
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canArchiveNote
// ─────────────────────────────────────────────────────────────────────────────

describe("canArchiveNote", () => {
  it("supervisor can archive", () => {
    const r = canArchiveNote(viewer({ role: "supervisor", facilityAccountId: 1 }), note());
    expect(r.ok).toBe(true);
  });
  it("author can archive their own", () => {
    const n = note({ authorFacilityAccountId: 7 });
    const r = canArchiveNote(viewer({ role: "caregiver", facilityAccountId: 7 }), n);
    expect(r.ok).toBe(true);
  });
  it("caregiver cannot archive others'", () => {
    const n = note({ authorFacilityAccountId: 7 });
    const r = canArchiveNote(viewer({ role: "caregiver", facilityAccountId: 99 }), n);
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canAcknowledgeNote / canReplyToNote
// ─────────────────────────────────────────────────────────────────────────────

describe("canAcknowledgeNote", () => {
  it("denies if you cannot view the note", () => {
    const n = note({ visibilityScope: "admin_only" });
    const r = canAcknowledgeNote(viewer({ role: "caregiver", facilityAccountId: 1 }), n);
    expect(r.ok).toBe(false);
  });
  it("allows for any same-facility visible note", () => {
    const r = canAcknowledgeNote(viewer({ role: "caregiver", facilityAccountId: 1 }), note());
    expect(r.ok).toBe(true);
  });
  it("blocks compliance_reviewer", () => {
    const r = canAcknowledgeNote(
      viewer({ role: "compliance_reviewer", facilityAccountId: 1 }),
      note(),
    );
    expect(r.ok).toBe(false);
  });
});

describe("canReplyToNote", () => {
  it("blocks reply on archived note", () => {
    const n = note({ archivedAt: NOW });
    const r = canReplyToNote(viewer({ role: "caregiver", facilityAccountId: 1 }), n);
    expect(r.ok).toBe(false);
  });
  it("allows reply on visible open note", () => {
    const r = canReplyToNote(viewer({ role: "caregiver", facilityAccountId: 1 }), note());
    expect(r.ok).toBe(true);
  });
});
