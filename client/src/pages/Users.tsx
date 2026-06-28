import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiSearchUsers } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { AdminBadge } from "@/components/AdminBadge";

export default function Users() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["/api/users/search", dq],
    queryFn: () => apiSearchUsers(dq).then((r) => r.users),
    enabled: dq.length >= 1,
  });

  const users = data ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-serif text-xl font-semibold mb-4">Find naturalists</h1>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by username or display name"
          className="pl-9"
          data-testid="input-user-search"
        />
      </div>
      {dq.length === 0 ? (
        <p className="text-sm text-muted-foreground">Start typing to search for users.</p>
      ) : isFetching ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users matched “{dq}”.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id}>
              <Link
                href={`/u/${u.username}`}
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover-elevate"
                data-testid={`link-user-${u.username}`}
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
                  <div className="text-xs text-muted-foreground truncate">
                    @{u.username} · {u.recordCount ?? 0} records · {u.followerCount ?? 0} followers
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
