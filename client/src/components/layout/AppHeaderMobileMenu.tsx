import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { LogOut, Menu, Settings, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAppHeaderAuth } from "@/hooks/useAppHeaderAuth";

export interface AppHeaderMobileMenuProps {
  /** Optional extras rendered below the account block (e.g. notes bell). */
  extras?: ReactNode;
  /** Forwarded onto the inline "Sign in" CTA when the user is anonymous. */
  onSignInOverride?: () => void;
}

/**
 * Hamburger sheet shown only on `< sm`. The desktop AppHeader already
 * renders the chip + back button + rightSlot inline; on mobile we collapse
 * the account block + auxiliary actions into a right-side drawer.
 */
export function AppHeaderMobileMenu({
  extras,
  onSignInOverride,
}: AppHeaderMobileMenuProps) {
  const [, setLocation] = useLocation();
  const auth = useAppHeaderAuth();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72 p-0 flex flex-col">
        <SheetHeader className="px-4 pt-5 pb-3">
          <SheetTitle className="text-sm font-semibold">Menu</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-3">
          {auth.role === "anon" ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => {
                close();
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
          ) : (
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-brand-primary text-white text-sm font-semibold">
                  {auth.initials ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900 truncate">
                  {auth.displayName}
                </p>
                {auth.email && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {auth.email}
                  </p>
                )}
                {auth.roleLabel && (
                  <Badge
                    variant="outline"
                    className="mt-1 h-4 px-1.5 text-[9px] font-medium uppercase tracking-wide leading-none border-stone-200 text-stone-600"
                  >
                    {auth.roleLabel}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        {extras && (
          <>
            <Separator />
            <div className="px-4 py-3 flex flex-col gap-2">{extras}</div>
          </>
        )}

        <Separator />

        {auth.role !== "anon" && (
          <div className="px-4 py-3 flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start gap-2"
              onClick={() => {
                close();
                setLocation(auth.homePath);
              }}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start gap-2 text-stone-700"
              onClick={async () => {
                close();
                await auth.signOut();
                setLocation("/map");
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
