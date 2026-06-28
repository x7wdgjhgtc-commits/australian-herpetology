/**
 * NotificationsDropdown — small popover triggered by the bell icon in the
 * top nav. Shows the most recent ~10 notifications without leaving the
 * current page. Clicking a row marks it read and navigates to the relevant
 * record / note. A "View all" link at the bottom routes to /notifications
 * for full management.
 *
 * Why a popover, not a DropdownMenu: the menu primitive auto-closes on every
 * keystroke / focus change and doesn't play nicely with a scrollable list of
 * action buttons. Popover gives us a real positioned overlay with explicit
 * open state control.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bell,
  Heart,
  MessageCircle,
  Reply,
  CheckCheck,
  Inbox,
  User as UserIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AdminBadge } from "@/components/AdminBadge";
import {
  apiListNotifications,
  apiUnreadNotificationCount,
  apiMarkNotificationRead,
  apiMarkAllNotificationsRead,
  type AppNotification,
  type NotificationType,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function notificationVerb(n: AppNotification): string {
  switch (n.type) {
    case "record_like":
      return "liked your record";
    case "record_comment":
      return "commented on your record";
    case "comment_reply":
      return "replied to your comment";
    case "comment_like":
      return "liked your comment";
    case "note_like":
      return "liked your observation note";
    case "note_comment":
      return "commented on your observation note";
    case "note_comment_reply":
      return "replied to your comment";
    case "note_comment_like":
      return "liked your comment";
  }
}

function NotificationIcon({ type }: { type: NotificationType }) {
  const cls = "h-3.5 w-3.5";
  switch (type) {
    case "record_like":
    case "comment_like":
    case "note_like":
    case "note_comment_like":
      return <Heart className={`${cls} fill-red-500 text-red-500`} />;
    case "record_comment":
    case "note_comment":
      return <MessageCircle className={`${cls} text-primary`} />;
    case "comment_reply":
    case "note_comment_reply":
      return <Reply className={`${cls} text-primary`} />;
  }
}

function notificationLink(n: AppNotification): string | null {
  if (n.noteId != null) return `/n/${n.noteId}`;
  if (n.recordId == null) return null;
  return `/r/${n.recordId}`;
}

export function NotificationsDropdown() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  // Unread badge — polled regardless of dropdown state so the dot stays fresh
  const countQ = useQuery({
    queryKey: ["/api/notifications/unread-count"],
    queryFn: () => apiUnreadNotificationCount(),
    enabled: !!user,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Full list — only fetched when the popover is opened. Limit 10 for the
  // compact dropdown view.
  const listQ = useQuery({
    queryKey: ["/api/notifications", { limit: 10 }],
    queryFn: () => apiListNotifications({ limit: 10 }),
    enabled: !!user && open,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiMarkNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/unread-count"],
      });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiMarkAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/unread-count"],
      });
    },
  });

  if (!user) return null;

  const count = countQ.data?.unreadCount ?? 0;
  const items = listQ.data?.notifications ?? [];

  const handleOpen = (n: AppNotification) => {
    if (n.readAt == null) markRead.mutate(n.id);
    const href = notificationLink(n);
    setOpen(false);
    if (href) setLocation(href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative w-9 h-9 rounded-full hover-elevate flex items-center justify-center"
          data-testid="button-notifications-bell"
          aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center border-2 border-card"
              data-testid="badge-notifications-unread"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-80 sm:w-96 p-0 overflow-hidden"
        data-testid="popover-notifications"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="font-medium text-sm">Notifications</div>
          {count > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 disabled:opacity-50"
              data-testid="button-notifications-mark-all-read"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {listQ.isLoading && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Loading…
            </div>
          )}
          {!listQ.isLoading && items.length === 0 && (
            <div className="px-3 py-8 text-center">
              <Inbox className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <div className="text-xs text-muted-foreground">
                No notifications yet
              </div>
            </div>
          )}
          {items.map((n) => {
            const unread = n.readAt == null;
            const actor = n.actor;
            const verb = notificationVerb(n);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => handleOpen(n)}
                className={cn(
                  "w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 hover-elevate",
                  unread && "bg-primary/5",
                )}
                data-testid={`row-notification-${n.id}`}
              >
                {/* avatar */}
                <div className="relative shrink-0">
                  {actor?.avatarUrl ? (
                    <img
                      src={actor.avatarUrl}
                      alt={actor.username || actor.displayName || "User"}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-muted-foreground">
                      <UserIcon className="h-4 w-4" />
                    </div>
                  )}
                  <div className="absolute -bottom-0.5 -right-0.5 bg-card rounded-full p-0.5 border border-border">
                    <NotificationIcon type={n.type} />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs leading-snug">
                    <span className="font-semibold">
                      {actor?.displayName || actor?.username || "Someone"}
                    </span>
                    {actor ? (
                      <AdminBadge user={actor} variant="compact" className="ml-1 align-middle" />
                    ) : null}{" "}
                    <span className="text-muted-foreground">{verb}</span>
                  </div>
                  {n.snippet && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {n.snippet}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatTimestamp(n.createdAt)}
                  </div>
                </div>

                {unread && (
                  <div
                    className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5"
                    aria-label="Unread"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setLocation("/notifications");
            }}
            className="w-full text-center text-xs py-2 text-primary hover:bg-muted/50"
            data-testid="link-notifications-view-all"
          >
            View all notifications
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationsDropdown;
