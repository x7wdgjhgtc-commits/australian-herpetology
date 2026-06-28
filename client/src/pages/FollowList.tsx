import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiGetFollowers, apiGetFollowing } from "@/lib/api";
import { AdminBadge } from "@/components/AdminBadge";

export default function FollowList({ mode }: { mode: "followers" | "following" }) {
  const [, params] = useRoute(mode === "followers" ? "/u/:username/followers" : "/u/:username/following");
  const username = params?.username || "";

  const q = useQuery({
    queryKey: ["/api/users", username, mode],
    queryFn: () =>
      mode === "followers"
        ? apiGetFollowers(username).then((r) => r.users)
        : apiGetFollowing(username).then((r) => r.users),
    enabled: !!username,
  });

  const users = q.data ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-4">
        <Link href={`/u/${username}`} className="text-sm text-muted-foreground hover:underline">
          ← @{username}
        </Link>
      </div>
      <h1 className="font-serif text-xl font-semibold mb-4 capitalize">{mode}</h1>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users yet.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id}>
              <Link
                href={`/u/${u.username}`}
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover-elevate"
              >
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                  {u.avatarDataUrl && (
                    <img src={u.avatarDataUrl} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{u.displayName || u.username}</span>
                    <AdminBadge user={u} variant="compact" />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Followers() {
  return <FollowList mode="followers" />;
}
export function Following() {
  return <FollowList mode="following" />;
}
