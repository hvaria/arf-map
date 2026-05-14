import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CredentialsSection } from "@/components/CredentialsSection";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

// All job types relevant to Adult Residential Facilities. Mirrored from the
// original list in JobSeekerPage so the form options stay identical after
// the editor moved into a shared component.
export const JOB_TYPE_OPTIONS = [
  "Caregiver",
  "Direct Support Professional (DSP)",
  "Program Director",
  "Administrator",
  "House Manager",
  "Night Awake Staff",
  "On-call / PRN Staff",
  "Cook / Chef",
  "Activities Coordinator",
  "Registered Nurse (RN)",
  "Licensed Vocational Nurse (LVN)",
  "Certified Nursing Assistant (CNA)",
  "Medication Technician",
  "Social Worker",
  "Case Manager",
  "Mental Health Worker",
  "Behavior Technician",
  "Life Skills Coach",
  "Vocational Instructor",
  "Driver / Transportation",
  "Maintenance / Facilities",
  "Office Manager",
];

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Resize image to max 300x300 and return base64 data URL. Lifted verbatim
// from JobSeekerPage's helper so the upload behavior is identical.
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 300;
        let { width, height } = img;
        if (width > height) {
          if (width > max) { height = (height * max) / width; width = max; }
        } else {
          if (height > max) { width = (width * max) / height; height = max; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Profile picture uploader ─────────────────────────────────────────────────

function ProfilePicture({
  url,
  onChange,
}: {
  url: string;
  onChange: (dataUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please choose an image under 5 MB.", variant: "destructive" });
      return;
    }
    try {
      const dataUrl = await resizeImage(file);
      onChange(dataUrl);
    } catch {
      toast({ title: "Failed to process image", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed border-primary/30 hover:border-primary/60 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        {url ? (
          <img src={url} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-primary/50">
            <Camera className="h-6 w-6" />
            <span className="text-[10px] font-medium">Add photo</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-xs text-primary hover:underline"
      >
        {url ? "Change photo" : "Upload photo"}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Profile editor ───────────────────────────────────────────────────────────

interface SeekerProfileEditorProps {
  profile: JobSeekerProfile | null;
  /**
   * Called after a successful save AND when the user clicks Cancel — the
   * parent decides whether that means "close the editor" or "reset state".
   */
  onSaved: () => void;
}

/**
 * SeekerProfileEditor — the editable form for a job seeker's profile.
 *
 * Extracted from JobSeekerPage.tsx so the dashboard can render the same
 * editor inline. Owns its own form state (initialised + re-synced from
 * the `profile` prop) and PUTs to /api/jobseeker/profile, invalidating
 * the shared query cache on success.
 */
export function SeekerProfileEditor({ profile, onSaved }: SeekerProfileEditorProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    profilePictureUrl: profile?.profilePictureUrl ?? "",
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    zipCode: profile?.zipCode ?? "",
    yearsExperience: String(profile?.yearsExperience ?? ""),
    bio: profile?.bio ?? "",
    jobTypes: profile?.jobTypes ?? [],
  });

  useEffect(() => {
    if (profile) {
      setForm({
        profilePictureUrl: profile.profilePictureUrl ?? "",
        firstName: profile.firstName ?? "",
        lastName: profile.lastName ?? "",
        phone: profile.phone ?? "",
        address: profile.address ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        zipCode: profile.zipCode ?? "",
        yearsExperience: String(profile.yearsExperience ?? ""),
        bio: profile.bio ?? "",
        jobTypes: profile.jobTypes ?? [],
      });
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/jobseeker/profile", {
        profilePictureUrl: form.profilePictureUrl || undefined,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        zipCode: form.zipCode || undefined,
        yearsExperience: form.yearsExperience ? parseInt(form.yearsExperience, 10) : undefined,
        bio: form.bio || undefined,
        jobTypes: form.jobTypes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/profile"] });
      toast({ title: "Profile saved!" });
      onSaved();
    },
    onError: (err: any) => {
      // A 401 means the session expired while the editor was open
      // (stale React Query cache). Force-refresh the /me query so the app
      // redirects the user back to the login form immediately.
      if (err.message?.includes("Authentication required")) {
        qc.invalidateQueries({ queryKey: ["/api/jobseeker/me"] });
      }
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleJobType = (type: string) => {
    setForm((f) => ({
      ...f,
      jobTypes: f.jobTypes.includes(type)
        ? f.jobTypes.filter((t) => t !== type)
        : [...f.jobTypes, type],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Profile picture */}
      <ProfilePicture
        url={form.profilePictureUrl}
        onChange={(url) => setForm((f) => ({ ...f, profilePictureUrl: url }))}
      />

      {/* Name */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Personal Info</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>First Name</Label>
            <Input
              placeholder="Jane"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Last Name</Label>
            <Input
              placeholder="Smith"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact Number</Label>
            <Input
              type="tel"
              placeholder="(530) 555-0100"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Years of Experience</Label>
            <Input
              type="number"
              min={0}
              max={50}
              placeholder="0"
              value={form.yearsExperience}
              onChange={(e) => setForm((f) => ({ ...f, yearsExperience: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Address</h4>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Street Address</Label>
            <Input
              placeholder="123 Main St"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>City</Label>
              <Input
                placeholder="Sacramento"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              >
                <option value="">State</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Zip Code</Label>
              <Input
                placeholder="95814"
                maxLength={10}
                value={form.zipCode}
                onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bio */}
      <div className="space-y-1.5">
        <Label>Bio / About Me</Label>
        <Textarea
          placeholder="Brief introduction about your background and goals…"
          rows={3}
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
        />
      </div>

      {/* Credentials — managed via /api/jobseeker/credentials. Lives
          inside the editor (not the read-only card) so the seeker
          edits everything in one place. */}
      <CredentialsSection />

      {/* Job types */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Positions I'm Looking For
        </h4>
        <p className="text-xs text-muted-foreground mb-3">Select all that apply</p>
        <div className="flex flex-wrap gap-2">
          {JOB_TYPE_OPTIONS.map((type) => {
            const selected = form.jobTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleJobType(type)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  selected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {selected && <CheckCircle2 className="h-3 w-3" />}
                {type}
              </button>
            );
          })}
        </div>
        {form.jobTypes.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">{form.jobTypes.length} selected</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1">
          {saveMutation.isPending ? "Saving…" : "Save Profile"}
        </Button>
        <Button variant="outline" onClick={onSaved}>Cancel</Button>
      </div>
    </div>
  );
}
