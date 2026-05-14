import { ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export interface AppHeaderBackButtonProps {
  /** wouter route target (without leading "#"). */
  to: string;
  /** Visible label shown on `>= sm`. Hidden on mobile (icon only). */
  label?: string;
}

/**
 * Chevron + label affordance + a vertical separator. The separator is
 * rendered as part of this component so the AppHeader layout doesn't
 * have to know whether a back button is present or not.
 */
export function AppHeaderBackButton({
  to,
  label = "Back",
}: AppHeaderBackButtonProps) {
  const [, setLocation] = useLocation();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setLocation(to)}
        className="text-muted-foreground hover:text-foreground gap-1.5 px-2"
        aria-label={`Back to ${label}`}
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
      </Button>
      <Separator orientation="vertical" className="h-6 mx-2 hidden sm:block" />
    </>
  );
}
