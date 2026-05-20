// Leaf types for the job-seeker profile shape returned by
// `GET /api/jobseeker/profile`. Extracted out of
// `client/src/components/seeker/SeekerProfileEditor.tsx` so that
// non-UI modules (e.g. the onboarding wizard, the dashboard page,
// the auth-screen redirect logic) can reference the type without
// dragging the editor's heavy import graph (Camera icon, mutation
// hooks, WorkExperienceSection, CredentialsSection) into their own
// bundles or test transforms.
//
// The SeekerProfileEditor re-exports this symbol unchanged for
// backwards compatibility with pre-existing import sites — both
// `from "@/lib/seekerProfileTypes"` and
// `from "@/components/seeker/SeekerProfileEditor"` resolve to the
// same identifier.
//
// NOTE: this is a CLIENT-PARSED shape — `jobTypes` arrives over the
// wire as a JSON-encoded TEXT column on `job_seeker_profiles` and
// is parsed to `string[]` before the type is materialized. The
// Drizzle-inferred type in `shared/schema.ts:262` has the raw TEXT
// representation; do not confuse the two.

export interface JobSeekerProfile {
  id: number;
  accountId: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  profilePictureUrl: string | null;
  yearsExperience: number | null;
  jobTypes: string[];
  bio: string | null;
  updatedAt: number;
}
