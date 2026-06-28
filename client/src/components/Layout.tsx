import { Link, useLocation } from "wouter";
import {
  BookOpen,
  Map as MapIcon,
  Search,
  Info,
  Compass,
  Plus,
  LogOut,
  Settings,
  User as UserIcon,
  Trophy,
  Shield,
  FileText,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import logoLight from "@/assets/logo.png";
import logoDark from "@/assets/logo-dark.png";

const NAV = [
  { href: "/", label: "Feed", icon: Compass, exact: true },
  { href: "/browse", label: "Species", icon: BookOpen },
  { href: "/map", label: "Map Search", icon: MapIcon },
  { href: "/leaderboard", label: "Leaderboards", icon: Trophy },
  { href: "/about", label: "About", icon: Info },
];

const MOBILE_NAV = [
  { href: "/", label: "Feed", icon: Compass, exact: true },
  { href: "/browse", label: "Species", icon: BookOpen },
  { href: "/map", label: "Map", icon: MapIcon },
  { href: "/about", label: "About", icon: Info },
];

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <>
      <img
        src={logoLight}
        alt="Australian Herpetology"
        className={`h-9 sm:h-10 w-auto select-none dark:hidden ${className}`}
        draggable={false}
        data-testid="img-brand-logo"
      />
      <img
        src={logoDark}
        alt="Australian Herpetology"
        className={`h-9 sm:h-10 w-auto select-none hidden dark:block ${className}`}
        draggable={false}
        aria-hidden="true"
      />
    </>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/login")}
          data-testid="button-header-login"
        >
          Log in
        </Button>
        <Button
          size="sm"
          onClick={() => setLocation("/signup")}
          data-testid="button-header-signup"
        >
          Sign up
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setLocation("/new")}
        data-testid="button-header-new"
        className="hidden sm:inline-flex"
      >
        <Plus className="h-4 w-4 sm:mr-1.5" />
        <span className="hidden sm:inline">New</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-9 h-9 rounded-full bg-muted overflow-hidden border border-border hover-elevate"
            data-testid="button-user-menu"
            aria-label="Open user menu"
          >
            {user.avatarDataUrl ? (
              <img
                src={user.avatarDataUrl}
                alt=""
                className="w-full h-full object-cover"
                style={{ objectPosition: user.avatarPos || "50% 50%" }}
              />
            ) : (
              <UserIcon className="w-4 h-4 mx-auto text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="font-medium leading-tight">{user.displayName || user.username}</div>
            <div className="text-xs text-muted-foreground leading-tight">@{user.username}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation(`/u/${user.username}`)} data-testid="menu-profile">
            <UserIcon className="h-4 w-4 mr-2" /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/new")} data-testid="menu-new">
            <Plus className="h-4 w-4 mr-2" /> New record
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/notes/new")} data-testid="menu-new-note">
            <FileText className="h-4 w-4 mr-2" /> Write observation note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/users")} data-testid="menu-users">
            <Search className="h-4 w-4 mr-2" /> Find users
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/me/edit")} data-testid="menu-edit">
            <Settings className="h-4 w-4 mr-2" /> Edit profile
          </DropdownMenuItem>
          {user.role && user.role !== "none" ? (
            <DropdownMenuItem
              onClick={() => setLocation("/admin")}
              data-testid="menu-admin"
            >
              <Shield className="h-4 w-4 mr-2" /> Admin panel
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await logout();
              setLocation("/");
            }}
            data-testid="menu-logout"
          >
            <LogOut className="h-4 w-4 mr-2" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const isActive = (href: string, exact?: boolean) =>
    exact ? location === href : location === href || location.startsWith(href + "/");

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 hover-elevate rounded-md px-2 py-1 -ml-2" data-testid="link-home-logo">
            <Wordmark />
            <span className="sr-only" data-testid="text-brand">Australian Herpetology</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium hover-elevate flex items-center gap-2",
                  isActive(item.href, item.exact)
                    ? "text-primary"
                    : "text-foreground/70",
                )}
                data-testid={`link-nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* Mobile: search shortcut */}
            <Link
              href="/browse"
              className="md:hidden p-2 rounded-md hover-elevate"
              data-testid="link-mobile-search"
              aria-label="Search species"
            >
              <Search className="h-5 w-5" />
            </Link>
            <NotificationsDropdown />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 pb-20 md:pb-8">{children}</main>

      {/* Footer */}
      <footer className="hidden md:block border-t border-border bg-card/40 py-6 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <div>
            Species data &amp; photos sourced from{" "}
            <a
              className="underline hover:text-primary"
              href="https://www.ala.org.au/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Atlas of Living Australia
            </a>{" "}
            and{" "}
            <a
              className="underline hover:text-primary"
              href="https://www.inaturalist.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              iNaturalist
            </a>
            . Photo credits and licenses are shown on each species page.
          </div>
          <div>© {new Date().getFullYear()} Australian Herpetology</div>
        </div>
      </footer>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur border-t border-border">
        <div className="grid grid-cols-4 h-16">
          {MOBILE_NAV.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[11px]",
                  active ? "text-primary" : "text-foreground/60",
                )}
                data-testid={`link-tab-${item.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
