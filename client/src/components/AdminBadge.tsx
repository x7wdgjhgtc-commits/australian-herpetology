/**
 * AdminBadge — small pill that appears next to a user's name to advertise
 * their administrative role. Renders nothing for non-admin roles (`none` or
 * undefined) so it can be dropped in anywhere without conditional wrapping.
 *
 * Variants:
 *   - "chip" (default): full pill with icon + role label, for prominent
 *     surfaces like profile headers and feed cards.
 *   - "compact": icon-only pill with the role accessible via tooltip, for
 *     dense lists (comments, follower lists, dropdown notifications).
 */
import { Shield, ShieldCheck, ShieldHalf, Pencil, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole, AppUser } from "@/lib/api";

interface RoleStyle {
  label: string;
  Icon: typeof Shield;
  className: string; // background + text + ring
}

const ROLE_STYLES: Record<Exclude<UserRole, "none">, RoleStyle> = {
  "super-admin": {
    label: "Super Admin",
    Icon: ShieldCheck,
    // amber — denotes the highest privilege; matches Will's role.
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
  },
  admin: {
    label: "Admin",
    Icon: Shield,
    className:
      "bg-primary/15 text-primary ring-1 ring-primary/30",
  },
  editor: {
    label: "Editor",
    Icon: Pencil,
    className:
      "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30",
  },
  moderator: {
    label: "Moderator",
    Icon: Gavel,
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  },
};

// Older code may have stored "moderator" variants — also accept future roles
// without crashing. Anything not in ROLE_STYLES with a non-"none" value falls
// back to the generic admin styling so we still surface privilege.
function styleFor(role: UserRole | string | undefined | null): RoleStyle | null {
  if (!role || role === "none") return null;
  if (role in ROLE_STYLES) return ROLE_STYLES[role as Exclude<UserRole, "none">];
  return {
    label: role.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
    Icon: ShieldHalf,
    className: "bg-muted text-foreground/80 ring-1 ring-border",
  };
}

export interface AdminBadgeProps {
  user?: Pick<AppUser, "role"> | null;
  role?: UserRole | string | null;
  variant?: "chip" | "compact";
  className?: string;
}

export function AdminBadge({
  user,
  role,
  variant = "chip",
  className,
}: AdminBadgeProps) {
  const resolvedRole = role ?? user?.role ?? null;
  const style = styleFor(resolvedRole);
  if (!style) return null;

  const { label, Icon, className: roleClass } = style;
  const title = `${label}`;

  if (variant === "compact") {
    return (
      <span
        title={title}
        aria-label={title}
        data-testid={`badge-admin-${resolvedRole}`}
        className={cn(
          "inline-flex items-center justify-center rounded-full w-4 h-4 shrink-0",
          roleClass,
          className,
        )}
      >
        <Icon className="w-2.5 h-2.5" strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      title={title}
      data-testid={`badge-admin-${resolvedRole}`}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide shrink-0",
        roleClass,
        className,
      )}
    >
      <Icon className="w-3 h-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}

export default AdminBadge;
