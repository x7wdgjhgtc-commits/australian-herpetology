import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trophy, Medal, Award } from "lucide-react";
import { apiGetUserRankings, type RankingEntry } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shows where the user ranks on the various species leaderboards: overall,
 * by group (snakes/lizards/etc.) and by family. Only displays scopes where
 * the user has at least one species recorded.
 */
export function UserRankings({ username }: { username: string }) {
  const q = useQuery({
    queryKey: ["/api/users", username, "rankings"],
    queryFn: () => apiGetUserRankings(username),
    enabled: !!username,
    staleTime: 1000 * 60 * 2,
  });

  if (q.isLoading) {
    return (
      <div
        className="border border-border rounded-lg bg-card p-5 space-y-3"
        data-testid="card-rankings-loading"
      >
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-serif text-lg font-semibold">Leaderboard rankings</h2>
        </div>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (q.isError || !q.data) return null;

  const { total, groups, families } = q.data;
  const hasAny = !!total || groups.length > 0 || families.length > 0;
  if (!hasAny) return null;

  return (
    <div
      className="border border-border rounded-lg bg-card p-5 space-y-4"
      data-testid="card-rankings"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h2 className="font-serif text-lg font-semibold">Leaderboard rankings</h2>
        </div>
        <Link
          href="/leaderboard"
          className="text-xs text-primary hover:underline"
          data-testid="link-rankings-leaderboard"
        >
          Full leaderboards →
        </Link>
      </div>

      {/* Overall headline row */}
      {total && (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
          data-testid="row-rank-overall"
        >
          <div className="flex items-center gap-2 min-w-0">
            <RankBadge rank={total.rank} />
            <div className="min-w-0">
              <div className="text-sm font-medium">All AU herps</div>
              <div className="text-[11px] text-muted-foreground">
                Across every group
              </div>
            </div>
          </div>
          <RankPill entry={total} href="/leaderboard" />
        </div>
      )}

      {/* Per-group rankings */}
      {groups.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            By group
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {groups.map((g) => (
              <div
                key={g.key}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md hover-elevate"
                data-testid={`row-rank-group-${g.key}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={g.rank} small />
                  <span className="text-sm truncate">{g.label}</span>
                </div>
                <RankPill entry={g} href={`/leaderboard?scope=${g.key}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-family rankings — top 6 best-ranked families */}
      {families.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            By family
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {families.slice(0, 6).map((f) => (
              <div
                key={f.familyId}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md hover-elevate"
                data-testid={`row-rank-family-${f.familyId}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={f.rank} small />
                  <span className="text-sm italic font-serif truncate">
                    {f.familyName}
                  </span>
                </div>
                <RankPill
                  entry={f}
                  href={`/leaderboard?familyId=${f.familyId}`}
                />
              </div>
            ))}
          </div>
          {families.length > 6 && (
            <div className="text-[11px] text-muted-foreground pt-1">
              + {families.length - 6} more famil{families.length - 6 === 1 ? "y" : "ies"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank, small }: { rank: number; small?: boolean }) {
  const sizing = small ? "h-5 w-7 text-[10px]" : "h-6 w-8 text-xs";
  let tone = "bg-muted text-muted-foreground";
  let Icon: typeof Trophy | null = null;
  if (rank === 1) {
    tone = "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    Icon = Trophy;
  } else if (rank === 2) {
    tone = "bg-slate-400/15 text-slate-600 dark:text-slate-300";
    Icon = Medal;
  } else if (rank === 3) {
    tone = "bg-orange-700/15 text-orange-700 dark:text-orange-400";
    Icon = Award;
  }
  return (
    <span
      className={`inline-flex items-center justify-center gap-0.5 rounded-md font-semibold tabular-nums ${sizing} ${tone}`}
    >
      {Icon && <Icon className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />}#{rank}
    </span>
  );
}

function RankPill({ entry, href }: { entry: RankingEntry; href: string }) {
  return (
    <Link
      href={href}
      className="text-[11px] text-muted-foreground tabular-nums shrink-0 hover:text-primary hover:underline"
    >
      <span className="font-semibold text-foreground">{entry.speciesCount}</span> sp
      <span className="mx-1">·</span>
      of {entry.totalEntrants}
    </Link>
  );
}
