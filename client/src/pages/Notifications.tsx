import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bell,
  Heart,
  MessageCircle,
  Reply,
  CheckCheck,
  Check,
  Trash2,
  User as UserIcon,
  Inbox,
} from "lucide-react";
import {
  apiListNotifications,
  apiMarkNotificationRead,
  apiMarkNotificationUnread,
  apiMarkAllNotificationsRead,
  apiDeleteNotification,
  type AppNotification,
  type NotificationType,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AdminBadge } from "@/components/AdminBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { useState } from "react";

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
  const cls = "h-4 w-4";
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

function NotificationRow({
  n,
  onMarkRead,
  onMarkUnread,
  onDelete,
}: {
  n: AppNotification;
  onMarkRead: (id: number) => void;
  onMarkUnread: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [, setLocation] = useLocation();
  const unread = n.readAt == null;
  const href = notificationLink(n);

  const handleOpen = () => {
    if (unread) onMarkRead(n.id);
    if (href) setLocation(href);
  };

  return (
    <li
      className={[
        "rounded-md border bg-card p-3 flex items-start gap-3 transition-colors",
        unread
          ? "border-primary/40 bg-primary/[0.04]"
          : "border-border",
      ].join(" ")}
      data-testid={`notification-${n.id}`}
    >
      {/* Unread dot */}
      <div className="pt-1.5 shrink-0">
        {unread ? (
          <span
            className="block w-2 h-2 rounded-full bg-primary"
            aria-label="Unread"
            data-testid={`dot-unread-${n.id}`}
          />
        ) : (
          <span className="block w-2 h-2" />
        )}
      </div>

      {/* Actor avatar */}
      <Link
        href={n.actor ? `/u/${n.actor.username}` : "#"}
        className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 border border-border"
        data-testid={`avatar-actor-${n.id}`}
      >
        {n.actor?.avatarDataUrl ? (
          <img
            src={n.actor.avatarDataUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: n.actor.avatarPos || "50% 50%" }}
          />
        ) : (
          <UserIcon className="w-5 h-5 m-auto mt-2.5 text-muted-foreground" />
        )}
      </Link>

      {/* Body */}
      <button
        type="button"
        onClick={handleOpen}
        className="min-w-0 flex-1 text-left hover-elevate rounded-sm -mx-1 px-1 py-0.5"
        data-testid={`button-open-notification-${n.id}`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <NotificationIcon type={n.type} />
          <span className="text-sm">
            <span className="font-medium">
              {n.actor?.displayName || n.actor?.username || "Someone"}
            </span>
            {n.actor ? (
              <AdminBadge user={n.actor} variant="compact" className="ml-1 align-middle" />
            ) : null}{" "}
            <span className="text-muted-foreground">{notificationVerb(n)}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            · {formatTimestamp(n.createdAt)}
          </span>
        </div>
        {n.snippet ? (
          <p
            className="text-sm text-muted-foreground mt-1 line-clamp-2"
            data-testid={`text-notification-snippet-${n.id}`}
          >
            "{n.snippet}"
          </p>
        ) : null}
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {unread ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onMarkRead(n.id)}
            title="Mark as read"
            aria-label="Mark as read"
            data-testid={`button-mark-read-${n.id}`}
          >
            <Check className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => onMarkUnread(n.id)}
            title="Mark as unread"
            aria-label="Mark as unread"
            data-testid={`button-mark-unread-${n.id}`}
          >
            <Bell className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => onDelete(n.id)}
          title="Delete"
          aria-label="Delete"
          data-testid={`button-delete-notification-${n.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

export default function Notifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"all" | "unread">("all");

  const q = useQuery({
    queryKey: ["/api/notifications", tab],
    queryFn: () =>
      apiListNotifications({ limit: 100, unreadOnly: tab === "unread" }),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const items = q.data?.notifications ?? [];
  const unreadCount = q.data?.unreadCount ?? 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/notifications/unread-count"],
    });
  };

  const markReadM = useMutation({
    mutationFn: (id: number) => apiMarkNotificationRead(id),
    onSuccess: refresh,
  });
  const markUnreadM = useMutation({
    mutationFn: (id: number) => apiMarkNotificationUnread(id),
    onSuccess: refresh,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) => apiDeleteNotification(id),
    onSuccess: refresh,
  });
  const readAllM = useMutation({
    mutationFn: () => apiMarkAllNotificationsRead(),
    onSuccess: () => {
      refresh();
      toast({ title: "All notifications marked as read" });
    },
  });

  // Group: today / earlier
  const grouped = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();
    const today: AppNotification[] = [];
    const earlier: AppNotification[] = [];
    for (const n of items) {
      if (n.createdAt >= cutoff) today.push(n);
      else earlier.push(n);
    }
    return { today, earlier };
  }, [items]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-3">
            Log in to see notifications when people interact with your records.
          </p>
          <Button
            onClick={() => setLocation("/login")}
            data-testid="button-login-to-notifications"
          >
            Log in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <header className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1
            className="font-serif text-xl font-semibold flex items-center gap-2"
            data-testid="text-notifications-title"
          >
            <Bell className="h-5 w-5" />
            Notifications
          </h1>
          {unreadCount > 0 && (
            <Badge
              variant="default"
              data-testid="badge-unread-count"
            >
              {unreadCount} new
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => readAllM.mutate()}
          disabled={readAllM.isPending || unreadCount === 0}
          data-testid="button-mark-all-read"
        >
          <CheckCheck className="h-4 w-4 mr-1.5" />
          Mark all as read
        </Button>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "all" | "unread")}
        className="w-full mb-4"
      >
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid">
          <TabsTrigger value="all" data-testid="tab-all-notifications">
            All
          </TabsTrigger>
          <TabsTrigger value="unread" data-testid="tab-unread-notifications">
            Unread {unreadCount > 0 && `(${unreadCount})`}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <Inbox className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {tab === "unread"
              ? "No unread notifications."
              : "Nothing here yet — when people like or comment on your records, it'll show up here."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.today.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Today
              </h2>
              <ul className="space-y-2" data-testid="list-notifications-today">
                {grouped.today.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    onMarkRead={(id) => markReadM.mutate(id)}
                    onMarkUnread={(id) => markUnreadM.mutate(id)}
                    onDelete={(id) => deleteM.mutate(id)}
                  />
                ))}
              </ul>
            </section>
          )}
          {grouped.earlier.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Earlier
              </h2>
              <ul
                className="space-y-2"
                data-testid="list-notifications-earlier"
              >
                {grouped.earlier.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    onMarkRead={(id) => markReadM.mutate(id)}
                    onMarkUnread={(id) => markUnreadM.mutate(id)}
                    onDelete={(id) => deleteM.mutate(id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
