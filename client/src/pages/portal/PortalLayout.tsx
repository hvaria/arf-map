import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Pill,
  AlertTriangle,
  UserPlus,
  Receipt,
  CalendarDays,
  ShieldCheck,
  Menu,
  ArrowLeft,
  Building2,
} from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

const NAV_LINKS = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/residents", label: "Residents", icon: Users },
  { href: "/portal/emar", label: "eMAR", icon: Pill },
  { href: "/portal/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/portal/crm", label: "CRM", icon: UserPlus },
  { href: "/portal/billing", label: "Billing", icon: Receipt },
  { href: "/portal/staff", label: "Staff", icon: CalendarDays },
  { href: "/portal/compliance", label: "Compliance", icon: ShieldCheck },
];

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  onClick?: () => void;
}) {
  const [location] = useLocation();
  const isActive = exact
    ? location === href
    : location.startsWith(href);

  return (
    <Link href={href}>
      <a
        onClick={onClick}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "text-white"
            : "text-muted-foreground hover:bg-[#EEF2FF] hover:text-[#1E1B4B]"
        )}
        style={isActive ? { background: 'linear-gradient(90deg, #818CF8, #F9A8D4)' } : undefined}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </a>
    </Link>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Top navigation bar */}
      <header className="border-b sticky top-0 z-40" style={{ background: 'linear-gradient(135deg, #EEF2FF, #FFF0F6)', borderBottom: '1px solid #E0E7FF' }}>
        <div className="flex items-center gap-2 px-4 h-14">
          {/* Mobile hamburger */}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="p-4 border-b" style={{ background: 'linear-gradient(135deg, #EEF2FF, #FFF0F6)', borderBottom: '1px solid #E0E7FF' }}>
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" style={{ color: '#818CF8' }} />
                  <div>
                    <p className="text-sm font-semibold">
                      {me ? `Facility #${me.facilityNumber}` : "Portal"}
                    </p>
                    {me && (
                      <p className="text-xs text-muted-foreground">{me.username}</p>
                    )}
                  </div>
                </div>
              </div>
              <nav className="p-3 space-y-0.5" aria-label="Portal navigation">
                {NAV_LINKS.map((link) => (
                  <NavLink
                    key={link.href}
                    {...link}
                    onClick={() => setDrawerOpen(false)}
                  />
                ))}
                <div className="pt-3 mt-3 border-t">
                  <Link href="/">
                    <a
                      onClick={() => setDrawerOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to Map
                    </a>
                  </Link>
                </div>
              </nav>
            </SheetContent>
          </Sheet>

          {/* Logo / facility name */}
          <div className="flex items-center gap-2 mr-4">
            <Building2 className="h-5 w-5 shrink-0" style={{ color: '#818CF8' }} />
            <span className="text-sm font-semibold hidden sm:block">
              {me ? `Facility #${me.facilityNumber}` : "Facility Portal"}
            </span>
          </div>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1" aria-label="Portal navigation">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.href} {...link} />
            ))}
          </nav>

          {/* Back to map — desktop */}
          <div className="hidden md:block ml-auto">
            <Link href="/">
              <a className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-4 w-4" />
                Back to Map
              </a>
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 py-6 max-w-7xl w-full mx-auto bg-white">
        {children}
      </main>
    </div>
  );
}
