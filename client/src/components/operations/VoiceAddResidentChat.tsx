import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Mic, MicOff, Pencil, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  fuzzyMatchEnum,
  parsePhone,
  parseSpokenDate,
  type EnumOption,
} from "@/lib/voiceParse";

export interface AddResidentForm {
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  roomNumber: string;
  admissionDate: string;
  primaryDx: string;
  levelOfCare: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fundingSource: string;
  status: string;
}

type FieldType = "text" | "date" | "enum" | "phone";

interface StepDef {
  key: keyof AddResidentForm;
  shortLabel: string;
  prompt: string;
  type: FieldType;
  required?: boolean;
  enumOptions?: EnumOption[];
  hint?: string;
}

const STEPS: StepDef[] = [
  { key: "firstName", shortLabel: "First name", prompt: "What's the resident's first name?", type: "text", required: true },
  { key: "lastName", shortLabel: "Last name", prompt: "And their last name?", type: "text", required: true },
  { key: "dob", shortLabel: "Date of birth", prompt: "Date of birth?", type: "date", hint: "Try “March 5th 1947” or 3/5/1947." },
  { key: "gender", shortLabel: "Gender", prompt: "Gender?", type: "enum", enumOptions: [
    { value: "male", label: "Male" },
    { value: "female", label: "Female" },
    { value: "other", label: "Other" },
  ] },
  { key: "roomNumber", shortLabel: "Room", prompt: "Which room are they in?", type: "text" },
  { key: "admissionDate", shortLabel: "Admission date", prompt: "When were they admitted?", type: "date", hint: "Try “today” or “March 1st 2025”." },
  { key: "primaryDx", shortLabel: "Primary diagnosis", prompt: "What's their primary diagnosis?", type: "text" },
  { key: "levelOfCare", shortLabel: "Level of care", prompt: "Level of care?", type: "enum", enumOptions: [
    { value: "personal_care", label: "Personal Care", aliases: ["personal"] },
    { value: "assisted_living", label: "Assisted Living", aliases: ["assisted"] },
    { value: "memory_care", label: "Memory Care", aliases: ["memory"] },
    { value: "skilled_nursing", label: "Skilled Nursing", aliases: ["skilled", "nursing", "snf"] },
  ] },
  { key: "status", shortLabel: "Status", prompt: "Status?", type: "enum", enumOptions: [
    { value: "active", label: "Active" },
    { value: "discharged", label: "Discharged" },
    { value: "on_leave", label: "On Leave", aliases: ["leave"] },
  ] },
  { key: "emergencyContactName", shortLabel: "Emergency contact", prompt: "Emergency contact name?", type: "text" },
  { key: "emergencyContactPhone", shortLabel: "Emergency phone", prompt: "Emergency contact phone?", type: "phone" },
  { key: "fundingSource", shortLabel: "Funding source", prompt: "Funding source?", type: "enum", enumOptions: [
    { value: "private_pay", label: "Private Pay", aliases: ["private"] },
    { value: "medi_cal", label: "Medi-Cal", aliases: ["medical", "medi cal", "medicaid"] },
    { value: "medicare", label: "Medicare" },
    { value: "insurance", label: "Insurance" },
    { value: "other", label: "Other" },
  ] },
];

function formatDateForDisplay(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = +m[1], mo = +m[2], d = +m[3];
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString();
}

function displayValue(step: StepDef, value: string): string {
  if (!value) return "";
  if (step.type === "date") return formatDateForDisplay(value);
  if (step.type === "enum") {
    const opt = step.enumOptions?.find((o) => o.value === value);
    return opt?.label ?? value;
  }
  return value;
}

function draftFromForm(step: StepDef, value: string): string {
  if (!value) return "";
  if (step.type === "date") return formatDateForDisplay(value);
  if (step.type === "enum") {
    const opt = step.enumOptions?.find((o) => o.value === value);
    return opt?.label ?? "";
  }
  return value;
}

type ParseResult = { ok: true; value: string } | { ok: false; error: string };

function parseAnswer(step: StepDef, raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (step.required) return { ok: false, error: "This field is required." };
    return { ok: true, value: "" };
  }
  switch (step.type) {
    case "text":
      return { ok: true, value: trimmed };
    case "phone":
      return { ok: true, value: parsePhone(trimmed) };
    case "date": {
      const iso = parseSpokenDate(trimmed);
      if (!iso) {
        return {
          ok: false,
          error: "Couldn’t read that date — try “March 5th 1947” or 3/5/1947.",
        };
      }
      return { ok: true, value: iso };
    }
    case "enum": {
      const match = fuzzyMatchEnum(trimmed, step.enumOptions ?? []);
      if (!match) {
        return {
          ok: false,
          error: "Didn’t catch that — pick one of the options below.",
        };
      }
      return { ok: true, value: match.value };
    }
  }
}

export interface VoiceAddResidentChatProps {
  form: AddResidentForm;
  setField: (key: keyof AddResidentForm, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}

export function VoiceAddResidentChat({
  form,
  setField,
  onSubmit,
  onCancel,
  isPending,
}: VoiceAddResidentChatProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const inReview = step >= STEPS.length;
  const currentStep = !inReview ? STEPS[step] : null;
  const scrollRef = useRef<HTMLDivElement>(null);

  const speech = useSpeechRecognition({
    continuous: false,
    interimResults: true,
    onFinal: (text) => {
      setDraft((prev) => (prev ? `${prev} ${text}` : text));
      setParseError(null);
    },
  });

  // Whenever the active step changes, pull the existing form value into the draft
  // so the user is editing what they already entered (back-button + review edits).
  useEffect(() => {
    if (!currentStep) {
      setDraft("");
      setParseError(null);
      return;
    }
    setDraft(draftFromForm(currentStep, form[currentStep.key]));
    setParseError(null);
    speech.stop();
    speech.reset();
    // We intentionally depend only on `step` — pulling form.* would clobber edits.
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [step]);

  const displayedInput = useMemo(() => {
    if (speech.listening && speech.interimText) {
      return draft ? `${draft} ${speech.interimText}` : speech.interimText;
    }
    return draft;
  }, [draft, speech.listening, speech.interimText]);

  function confirmStep() {
    if (!currentStep) return;
    speech.stop();
    const res = parseAnswer(currentStep, draft);
    if (!res.ok) {
      setParseError(res.error);
      return;
    }
    setField(currentStep.key, res.value);
    setStep((s) => s + 1);
  }

  function skipStep() {
    if (!currentStep || currentStep.required) return;
    speech.stop();
    setField(currentStep.key, "");
    setStep((s) => s + 1);
  }

  function goBack() {
    speech.stop();
    setStep((s) => Math.max(0, s - 1));
  }

  function jumpTo(targetStep: number) {
    speech.stop();
    setStep(targetStep);
  }

  function toggleMic() {
    if (!speech.supported) return;
    if (speech.listening) {
      speech.stop();
    } else {
      setParseError(null);
      speech.start();
    }
  }

  function selectEnumOption(opt: EnumOption) {
    setDraft(opt.label);
    setParseError(null);
  }

  const completedSteps = STEPS.slice(0, Math.min(step, STEPS.length));
  const submitDisabled = isPending || !form.firstName || !form.lastName;

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: "55vh" }}>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 px-2 py-3 rounded-md"
        style={{ background: "#FAFBFF", border: "1px solid #E0E7FF", maxHeight: "50vh" }}
      >
        {/* Intro */}
        <BotBubble>
          I’ll ask you a few questions one at a time. Speak your answers or
          type them — you can skip optional fields.
        </BotBubble>

        {/* Completed Q&A pairs */}
        {completedSteps.map((s, idx) => {
          const value = form[s.key];
          const display = displayValue(s, value);
          return (
            <div key={s.key} className="space-y-1.5">
              <BotBubble>{s.prompt}</BotBubble>
              <UserBubble onClick={() => jumpTo(idx)} title="Edit this answer">
                {display ? (
                  display
                ) : (
                  <span className="opacity-80 italic">skipped</span>
                )}
              </UserBubble>
            </div>
          );
        })}

        {/* Current question */}
        {currentStep && (
          <div className="space-y-1.5">
            <BotBubble>
              <div className="font-medium">
                {currentStep.prompt}
                {currentStep.required ? <span className="text-pink-600"> *</span> : null}
              </div>
              {currentStep.hint ? (
                <div className="text-xs text-muted-foreground mt-1">{currentStep.hint}</div>
              ) : null}
            </BotBubble>
          </div>
        )}

        {/* Review */}
        {inReview && (
          <div className="space-y-2">
            <BotBubble>
              Here’s what I have. Tap any row to edit, then confirm to add the resident.
            </BotBubble>
            <div
              className="ml-14 grid grid-cols-1 gap-1 rounded-md p-2"
              style={{ background: "white", border: "1px solid #E0E7FF" }}
            >
              {STEPS.map((s, idx) => {
                const display = displayValue(s, form[s.key]);
                return (
                  <button
                    key={s.key}
                    onClick={() => jumpTo(idx)}
                    className="flex items-center justify-between gap-3 text-sm rounded-md px-2 py-1.5 hover:bg-[#F0F4FF] transition-colors text-left"
                  >
                    <span className="text-muted-foreground">{s.shortLabel}</span>
                    <span className="font-medium flex items-center gap-1.5">
                      {display ? (
                        display
                      ) : (
                        <span className="text-muted-foreground italic">skipped</span>
                      )}
                      <Pencil className="h-3 w-3 opacity-40" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Input row for the current question */}
      {currentStep && (
        <div className="space-y-2">
          {currentStep.enumOptions && (
            <div className="flex flex-wrap gap-1.5">
              {currentStep.enumOptions.map((o) => {
                const active =
                  draft.toLowerCase().trim() === o.label.toLowerCase() ||
                  form[currentStep.key] === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => selectEnumOption(o)}
                    className="text-xs px-2.5 py-1 rounded-full transition-colors"
                    style={{
                      background: active ? "#6366F1" : "#EEF2FF",
                      color: active ? "white" : "#3730A3",
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={displayedInput}
              readOnly={speech.listening}
              onChange={(e) => {
                setDraft(e.target.value);
                setParseError(null);
              }}
              placeholder={
                speech.listening
                  ? "Listening…"
                  : speech.supported
                  ? "Type or tap the mic"
                  : "Type your answer"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmStep();
                }
              }}
              aria-label={currentStep.prompt}
              style={{ background: "white" }}
            />
            {speech.supported && (
              <Button
                type="button"
                variant={speech.listening ? "default" : "outline"}
                size="icon"
                onClick={toggleMic}
                className={cn(speech.listening && "animate-pulse")}
                aria-pressed={speech.listening}
                title={speech.listening ? "Stop listening" : "Start voice input"}
              >
                {speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
          </div>

          {parseError && (
            <div className="text-xs text-destructive">{parseError}</div>
          )}
          {speech.error === "not-allowed" && (
            <div className="text-xs text-destructive">
              Microphone permission denied. Type your answer instead.
            </div>
          )}
          {speech.error && speech.error !== "not-allowed" && speech.error !== "no-speech" && (
            <div className="text-xs text-muted-foreground">
              Voice input error ({speech.error}). You can still type.
            </div>
          )}
          {!speech.supported && (
            <div className="text-xs text-muted-foreground">
              Voice input isn’t available on this device — type your answers instead.
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={goBack} disabled={step === 0}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
              {!currentStep.required && (
                <Button variant="ghost" size="sm" onClick={skipStep}>
                  <SkipForward className="h-3.5 w-3.5 mr-1" />
                  Skip
                </Button>
              )}
            </div>
            <Button variant="gradient" size="sm" onClick={confirmStep}>
              {step === STEPS.length - 1 ? "Review" : "Next"}
              <Check className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Review footer */}
      {inReview && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => jumpTo(STEPS.length - 1)}
            disabled={isPending}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              size="sm"
              onClick={onSubmit}
              disabled={submitDisabled}
              title={
                !form.firstName || !form.lastName
                  ? "First and last name are required"
                  : undefined
              }
            >
              {isPending ? "Adding…" : "Add Resident"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div
        className="text-[10px] font-semibold uppercase tracking-wide pt-2 w-12 shrink-0"
        style={{ color: "#6366F1" }}
      >
        Assistant
      </div>
      <div
        className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[80%]"
        style={{ background: "white", border: "1px solid #E0E7FF" }}
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div className="flex items-start gap-2 justify-end">
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[80%] text-left hover:opacity-90 transition-opacity"
        style={{
          background: "linear-gradient(90deg,#6366F1,#EC4899)",
          color: "white",
          cursor: onClick ? "pointer" : "default",
        }}
      >
        {children}
      </button>
      <div className="text-[10px] font-semibold uppercase tracking-wide pt-2 w-12 shrink-0 text-right text-muted-foreground">
        You
      </div>
    </div>
  );
}
