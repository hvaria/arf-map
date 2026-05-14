import { useLocation } from "wouter";
import { LogOut, Settings, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAppHeaderAuth } from "@/hooks/useAppHeaderAuth";

export interface AppHeaderAccountChipProps {
  /**
   * Optional override for what happens when an anonymous user clicks
   * "Sign in". When omitted we route to `/jobseeker/login`. JobSeekerPage
   * supplies this to keep the user on the page (the form is inline).
   */
  onSignInOverride?: () => void;
}

/**
 * Right-side identity affordance. Renders either:
 *   - signed-in: avatar + (name + role badge on `>= sm`) wrapped in a
 *     DropdownMenu with Settings (TODO landing) + Sign out items.
 *   - anonymous: "Sign in" button.
 */
export function AppHeaderAccountChip({
  onSignInOverride,
}: AppHeaderAccountChipProps) {
  const [, setLocation] = useLocation();
  const auth = useAppHeaderAuth();

  if (auth.role === "anon") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs gap-1.5"
        onClick={() => {
          if (onSignInOverride) {
            onSignInOverride();
            return;
          }
          setLocation("/jobseeker/login");
        }}
      >
        <UserIcon className="h-3.5 w-3.5" />
        Sign in
      </Button>
    );
  }

  const initials = auth.initials ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-full p-0.5 sm:pr-2 transition-colors",
            "hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Account menu"
        >
          <Avatar className="h-8 w-8 bg-brand-primary text-white">
            <AvatarFallback className="bg-brand-primary text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:flex flex-col items-start min-w-0 max-w-[180px]">
            <span className="text-xs font-medium text-stone-900 truncate w-full text-left">
              {auth.displayName}
            </span>
            {auth.roleLabel && (
              <Badge
                variant="outline"
                className="h-4 px-1.5 text-[9px] font-medium uppercase tracking-wide leading-none border-stone-200 text-stone-600 mt-0.5"
              >
                {auth.roleLabel}
              </Badge>
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <div className="px-2 py-1.5">
          <p className="text-xs font-semibold text-stone-900 truncate">
            {auth.displayName}
          </p>
          {auth.email && (
            <p className="text-[11px] text-muted-foreground truncate">
              {auth.email}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // TODO: dedicated settings surface. For now route the user
            // back to their role home, which is where account-level
            // controls already live.
            setLocation(auth.homePath);
          }}
        >
          <Settings className="h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await auth.signOut();
            setLocation("/map");
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
