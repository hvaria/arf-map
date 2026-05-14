import {
  Briefcase,
  CheckCircle2,
  Edit3,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CredentialBadge, useCredentials } from "@/components/CredentialBadge";
import type { JobSeekerProfile } from "@/components/seeker/SeekerProfileEditor";

interface SeekerProfileCardProps {
  /** Profile pulled from /api/jobseeker/profile — may be null for brand-new seekers. */
  profile: JobSeekerProfile | null;
  /** Email of the signed-in seeker, used as the displayName fallback. */
  email: string;
  /** Click handler for the inline "Edit" affordance — parent decides whether
   * to expand inline / open a dialog. */
  onEdit: () => void;
}

/**
 * SeekerProfileCard — read-only summary card for the signed-in seeker's
 * profile: avatar, display name, "Profile complete" badge, contact bits,
 * role-types and credentials.
 *
 * Extracted from JobSeekerPage.tsx's `Dashboard` component so the same
 * card can be rendered from /jobseeker/dashboard. Credentials are read
 * via the shared `useCredentials` hook so it stays in lockstep with the
 * editor's CredentialsSection cache.
 */
export function SeekerProfileCard({ profile, email, onEdit }: SeekerProfileCardProps) {
  const { data: credentials } = useCredentials();
  const credentialList = credentials ?? [];

  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName ?? ""}`.trim()
    : null;

  // "Profile complete" criteria mirror the original Dashboard logic so
  // the badge meaning doesn't shift between surfaces.
  const isProfileComplete = !!(
    profile?.firstName &&
    profile?.city &&
    profile?.phone &&
    profile?.jobTypes &&
    profile.jobTypes.length > 0
  );

  return (
    <Card>
      <CardContent className="pt-5">
        <div>
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
              {profile?.profilePictureUrl ? (
                <img src={profile.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-primary" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-semibold">
                  {displayName || email.split("@")[0]}
                </h3>
                {isProfileComplete && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Profile complete
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />{email}
              </p>
              {(profile?.city || profile?.state) && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {[profile.city, profile.state].filter(Boolean).join(", ")}
                  {profile.zipCode && ` ${profile.zipCode}`}
                </p>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit3 className="h-4 w-4 mr-1.5" />Edit
            </Button>
          </div>

          {profile?.bio && (
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{profile.bio}</p>
          )}

          <div className="flex flex-wrap gap-3 mt-3 text-sm">
            {profile?.phone && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />{profile.phone}
              </span>
            )}
            {profile?.yearsExperience != null && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" />
                {profile.yearsExperience} yr{profile.yearsExperience !== 1 ? "s" : ""} exp
              </span>
            )}
            {profile?.address && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />{profile.address}
              </span>
            )}
          </div>

          {profile?.jobTypes && profile.jobTypes.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1.5">Looking for:</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.jobTypes.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
            </div>
          )}

          {credentialList.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1.5">Credentials:</p>
              <div className="flex flex-wrap gap-1.5">
                {credentialList.map((c) => (
                  <CredentialBadge key={c.id} credential={c} />
                ))}
              </div>
            </div>
          )}

          {!isProfileComplete && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
              Complete your profile so facilities can find you.{" "}
              <button onClick={onEdit} className="underline font-medium">
                Set it up →
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
