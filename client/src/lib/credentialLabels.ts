// credentialLabels — re-export of the canonical CREDENTIAL_LABEL map.
//
// The source of truth moved to `shared/credentialLabels.ts` so the server
// resume renderer and the client share one label map. This module stays as
// a thin re-export so the many existing client import sites
// (`@/lib/credentialLabels`, `@/components/CredentialBadge`) keep working
// without a coordinated rename.
export { CREDENTIAL_LABEL } from "@shared/credentialLabels";
