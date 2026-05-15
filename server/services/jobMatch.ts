// Tag-based job matching for the job seeker feed.
//
// A seeker's profile carries a `jobTypes` array — the multi-select chip
// list rendered in ProfileEditor's "Roles I work" section. Each entry is
// one of the canonical role labels (JOB_TYPE_OPTIONS). This module maps
// those canonical labels to the real-world title aliases facilities
// actually write into a posting, then exposes a single predicate the
// /api/jobs route uses to filter the feed.
//
// Why a keyword library (vs. a plain substring match): the canonical
// labels include parentheticals like "Direct Support Professional (DSP)"
// or "Certified Nursing Assistant (CNA)". A literal substring match
// against the full canonical label would miss a job titled "DSP" or
// "CNA". We split each canonical label into its real-world keywords
// so both written forms hit.

const TAG_KEYWORDS: Record<string, string[]> = {
  "Caregiver": ["caregiver"],
  "Direct Support Professional (DSP)": ["direct support", "dsp"],
  "Program Director": ["program director"],
  "Administrator": ["administrator", "admin"],
  "House Manager": ["house manager"],
  "Night Awake Staff": ["night awake", "noc", "overnight"],
  "On-call / PRN Staff": ["on-call", "on call", "prn", "per diem", "per-diem"],
  "Cook / Chef": ["cook", "chef"],
  "Activities Coordinator": ["activities", "activity coordinator"],
  "Registered Nurse (RN)": ["registered nurse", "rn"],
  "Licensed Vocational Nurse (LVN)": ["licensed vocational", "lvn"],
  "Certified Nursing Assistant (CNA)": ["cna", "certified nursing assistant", "nursing assistant"],
  "Medication Technician": ["medication technician", "med tech", "med-tech"],
  "Social Worker": ["social worker", "lcsw", "asw", "mft"],
  "Case Manager": ["case manager"],
  "Mental Health Worker": ["mental health"],
  "Behavior Technician": ["behavior technician", "behavior tech", "rbt", "bcba", "bcaba"],
  "Life Skills Coach": ["life skills coach", "skills coach"],
  "Vocational Instructor": ["vocational instructor", "vocational"],
  "Driver / Transportation": ["driver", "transportation"],
  "Maintenance / Facilities": ["maintenance"],
  "Office Manager": ["office manager", "office admin"],
};

/**
 * Keywords to search a job's text for, given a canonical seeker tag.
 * Unknown tags fall back to their own lowercased form so the matcher
 * still tries something rather than silently matching nothing.
 */
export function keywordsForTag(tag: string): string[] {
  const known = TAG_KEYWORDS[tag];
  if (known) return known;
  const trimmed = tag.trim();
  if (!trimmed) return [];
  return [trimmed.toLowerCase()];
}

interface MatchableJob {
  title: string;
  type: string;
  description: string;
}

/**
 * True if any of the seeker's tags has at least one keyword present in
 * the job's title / type / description text. Empty tag list returns
 * `true` so callers can pass through unfiltered with no special-casing.
 */
export function jobMatchesTags(job: MatchableJob, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const haystack = `${job.title} ${job.type} ${job.description ?? ""}`.toLowerCase();
  for (const tag of tags) {
    const keywords = keywordsForTag(tag);
    for (const kw of keywords) {
      if (haystack.includes(kw)) return true;
    }
  }
  return false;
}

/**
 * Parse a `?tags=Foo,Bar` query-string param into a deduped, trimmed
 * array. Returns an empty array on missing / empty / malformed input.
 */
export function parseTagsParam(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
