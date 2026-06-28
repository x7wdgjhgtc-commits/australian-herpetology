import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Trophy, Medal, Award, Sparkles } from "lucide-react";
import {
  apiGetLeaderboard,
  apiGetIdLeaderboard,
  type LeaderboardResponse,
  type LeaderboardEntry,
  type LeaderboardScope,
  type IdLeaderboardResponse,
  type IdLeaderboardEntry,
} from "@/lib/api";
import { GROUPS, FAMILIES } from "@/lib/taxonomy";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AdminBadge } from "@/components/AdminBadge";

/**
 * Leaderboard buckets:
 *   - All AU herps
 *   - Reptiles
 *   - Amphibians
 *   - Each group (snakes, lizards, turtles, crocs, frogs)
 *   - Each family
 *
 * Two modes (tabs):
 *   - Records: ranked by distinct species recorded
 *   - IDs: ranked by ID suggestions posted on other users' records
 */

interface Bucket {
  key: string;
  title: string;
  subtitle?: string;
  scope?: LeaderboardScope;
  familyId?: number;
}

function makeBuckets(): Bucket[] {
  const buckets: Bucket[] = [
    { key: "all", title: "All AU herps", subtitle: "Reptiles + amphibians", scope: "all" },
    { key: "reptiles", title: "Reptiles", subtitle: "Snakes, lizards, turtles, crocs", scope: "reptiles" },
    { key: "amphibians", title: "Amphibians", subtitle: "Frogs", scope: "amphibians" },
  ];
  for (const g of GROUPS) {
    buckets.push({
      key: `group-${g.value}`,
      title: g.label,
      subtitle: g.blurb,
      scope: g.value as LeaderboardScope,
    });
  }
  for (const f of FAMILIES) {
    buckets.push({
      key: `family-${f.id}`,
      title: f.name,
      subtitle: f.common,
      familyId: f.id,
    });
  }
  return buckets;
}

const BUCKETS = makeBuckets();

function MedalIcon({ rank }: { rank: number }) {
  if (rank === 0) return <Trophy className="h-4 w-4 text-yellow-500" />;
  if (rank === 1) return <Medal className="h-4 w-4 text-zinc-400" />;
  if (rank === 2) return <Award className="h-4 w-4 text-amber-700" />;
  return null;
}

function RecordsCard({
  bucket,
  data,
  isLoading,
}: {
  bucket: Bucket;
  data: LeaderboardResponse | undefined;
  isLoading: boolean;
}) {
  const entries: LeaderboardEntry[] = data?.entries ?? [];
  return (
    <div
      className="border border-border rounded-lg bg-card p-4"
      data-testid={`card-leaderboard-${bucket.key}`}
    >
      <div className="mb-3">
        <h3 className="font-serif text-base font-semibold leading-tight">
          {bucket.title}
        </h3>
        {bucket.subtitle && (
          <div className="text-[11px] text-muted-foreground">
            {bucket.subtitle}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-4/6" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No records yet.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {entries.slice(0, 3).map((e, i) => (
            <li
              key={e.user?.id ?? i}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid={`row-leader-${bucket.key}-${i}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="w-4 shrink-0 flex justify-center">
                  <MedalIcon rank={i} />
                </span>
                {e.user ? (
                  <Link
                    href={`/u/${e.user.username}`}
                    className="font-medium hover:text-primary hover:underline truncate inline-flex items-center gap-1"
                  >
                    <span className="truncate">{e.user.displayName || e.user.username}</span>
                    <AdminBadge user={e.user} variant="compact" />
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unknown</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                <span className="font-semibold text-foreground">
                  {e.speciesCount}
                </span>{" "}
                sp · {e.recordCount} rec
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function IdsCard({
  bucket,
  data,
  isLoading,
}: {
  bucket: Bucket;
  data: IdLeaderboardResponse | undefined;
  isLoading: boolean;
}) {
  const entries: IdLeaderboardEntry[] = data?.entries ?? [];
  return (
    <div
      className="border border-border rounded-lg bg-card p-4"
      data-testid={`card-ids-${bucket.key}`}
    >
      <div className="mb-3">
        <h3 className="font-serif text-base font-semibold leading-tight">
          {bucket.title}
        </h3>
        {bucket.subtitle && (
          <div className="text-[11px] text-muted-foreground">
            {bucket.subtitle}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-4/6" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No IDs posted yet.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {entries.slice(0, 3).map((e, i) => (
            <li
              key={e.user?.id ?? i}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid={`row-id-leader-${bucket.key}-${i}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="w-4 shrink-0 flex justify-center">
                  <MedalIcon rank={i} />
                </span>
                {e.user ? (
                  <Link
                    href={`/u/${e.user.username}`}
                    className="font-medium hover:text-primary hover:underline truncate inline-flex items-center gap-1"
                  >
                    <span className="truncate">{e.user.displayName || e.user.username}</span>
                    <AdminBadge user={e.user} variant="compact" />
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unknown</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                <span className="font-semibold text-foreground">
                  {e.idCount}
                </span>{" "}
                IDs · {e.acceptedCount} accepted
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const [tab, setTab] = useState<"records" | "ids">("records");

  const recordsResults = useQueries({
    queries: BUCKETS.map((b) => ({
      queryKey: ["/api/leaderboard", b.key],
      queryFn: () =>
        apiGetLeaderboard({
          scope: b.scope,
          familyId: b.familyId,
          limit: 3,
        }),
      staleTime: 1000 * 60 * 2,
      enabled: tab === "records",
    })),
  });

  const idsResults = useQueries({
    queries: BUCKETS.map((b) => ({
      queryKey: ["/api/leaderboard-ids", b.key],
      queryFn: () =>
        apiGetIdLeaderboard({
          scope: b.scope,
          familyId: b.familyId,
          limit: 3,
        }),
      staleTime: 1000 * 60 * 2,
      enabled: tab === "ids",
    })),
  });

  const headlineKeys = ["all", "reptiles", "amphibians"];
  const groupKeys = GROUPS.map((g) => `group-${g.value}`);
  const familyKeys = FAMILIES.map((f) => `family-${f.id}`);

  const recordsByKey = new Map<
    string,
    { data: LeaderboardResponse | undefined; isLoading: boolean }
  >();
  const idsByKey = new Map<
    string,
    { data: IdLeaderboardResponse | undefined; isLoading: boolean }
  >();
  BUCKETS.forEach((b, i) => {
    recordsByKey.set(b.key, {
      data: recordsResults[i].data,
      isLoading: recordsResults[i].isLoading,
    });
    idsByKey.set(b.key, {
      data: idsResults[i].data,
      isLoading: idsResults[i].isLoading,
    });
  });
  const bucketByKey = new Map(BUCKETS.map((b) => [b.key, b]));

  const renderSection = (
    title: string,
    keys: string[],
    gridClass: string,
  ) => (
    <section className="mb-10 last:mb-0">
      <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-3">
        {title}
      </h2>
      <div className={gridClass}>
        {keys.map((k) => {
          const b = bucketByKey.get(k)!;
          if (tab === "records") {
            const v = recordsByKey.get(k)!;
            return (
              <RecordsCard
                key={k}
                bucket={b}
                data={v.data}
                isLoading={v.isLoading}
              />
            );
          }
          const v = idsByKey.get(k)!;
          return (
            <IdsCard
              key={k}
              bucket={b}
              data={v.data}
              isLoading={v.isLoading}
            />
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Trophy className="h-7 w-7 text-primary" />
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Leaderboards
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {tab === "records"
            ? "Top 3 recorders ranked by distinct species seen, broken down by group and family. Species count is the primary rank; record count breaks ties."
            : "Top 3 identifiers ranked by ID suggestions posted on other users' records. Total IDs is the primary rank; accepted IDs breaks ties."}
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "records" | "ids")}
        className="w-full"
      >
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid mb-6">
          <TabsTrigger value="records" data-testid="tab-leaderboard-records">
            <Trophy className="h-4 w-4 mr-2" />
            Records
          </TabsTrigger>
          <TabsTrigger value="ids" data-testid="tab-leaderboard-ids">
            <Sparkles className="h-4 w-4 mr-2" />
            IDs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-0">
          {renderSection(
            "Overall",
            headlineKeys,
            "grid grid-cols-1 md:grid-cols-3 gap-4",
          )}
          {renderSection(
            "By group",
            groupKeys,
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
          )}
          {renderSection(
            "By family",
            familyKeys,
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
          )}
        </TabsContent>

        <TabsContent value="ids" className="mt-0">
          {renderSection(
            "Overall",
            headlineKeys,
            "grid grid-cols-1 md:grid-cols-3 gap-4",
          )}
          {renderSection(
            "By group",
            groupKeys,
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
          )}
          {renderSection(
            "By family",
            familyKeys,
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
