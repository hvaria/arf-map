/**
 * Tiny form scaffolding shared across portal dialogs.
 *
 * Goals (per the audit):
 *   • UX-1 inline validation errors instead of post-submit toasts
 *   • UX-2 visible required markers (asterisk + sr-only "required")
 *   • UX-3 Enter-to-submit on text inputs without manual onKeyDown wiring
 *
 * Intentionally minimal — full react-hook-form is overkill for the size of
 * dialogs we have. If complexity grows past basic field-level validation,
 * swap this for RHF.
 */
import { type ReactNode, type KeyboardEvent } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="flex items-center gap-1">
        <span>{label}</span>
        {required ? (
          <span aria-hidden className="text-red-500">*</span>
        ) : (
          <span className="text-[10px] text-muted-foreground font-normal">
            (optional)
          </span>
        )}
        {required && <span className="sr-only">required</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-[11px] text-red-600" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Wrap a dialog body with this to make Enter (without Shift) submit the
 * primary action. Skips when focus is inside a textarea so multi-line
 * inputs still work normally.
 */
export function onSubmitKey(handler: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    handler();
  };
}
