---
name: Expression of Interest Feature
description: Expression-of-interest connection layer between job seekers and facilities — curiosity-trap auth flow, applicant_interests table, 5 new API endpoints
type: project
---

Added a full "expression of interest" system connecting job seekers to facilities.

**Why:** Facility operators wanted to see interested candidates without requiring resume uploads.

**New table:** `applicant_interests` (SQLite) — `job_seeker_id` + `facility_number` UNIQUE pair, `role_interest`, `message`, `status` (pending/viewed/shortlisted), timestamps.

**New API endpoints (server/routes/interests.ts, registered at /api):**
- POST /api/jobseeker/interests
- GET /api/jobseeker/interests
- DELETE /api/jobseeker/interests/:id
- GET /api/facility/applicants
- PATCH /api/facility/applicants/:id

**Curiosity-trap auth flow:**
- Non-logged-in user clicks "Express Interest" → sessionStorage key `pending_action` written → redirect to `#/jobseeker/register`
- RegisterPage reads pending_action → shows context banner naming the facility
- After OTP verification OR login, `handlePostAuth()` fires the interest API silently → toast → navigate to map
- sessionStorage key cleared immediately after use

**New client files:**
- `client/src/lib/pendingAction.ts` — typed sessionStorage wrapper
- `client/src/components/StatusBadge.tsx` — pending/viewed/shortlisted badge
- `client/src/components/ExpressInterestButton.tsx` — 4-state button
- `client/src/components/ApplicantsTab.tsx` — facility view with status controls
- `client/src/components/MyInterestsTab.tsx` — job seeker interests list
- `client/src/pages/jobseeker/RegisterPage.tsx` — register+login page with context banner

**How to apply:** When editing any of these files, be careful not to break the pending_action sessionStorage flow — it must be written BEFORE redirect and cleared AFTER the interest API call succeeds.
