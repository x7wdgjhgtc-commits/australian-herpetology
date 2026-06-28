import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Compass, Plus, Users } from "lucide-react";
import { apiFeed, apiAllRecords, apiNotesFeed, apiListNotes, type AppNote } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecordCard } from "@/components/RecordCard";
import { FeedCard } from "@/components/FeedCard";
import { NoteCard } from "@/components/NoteCard";
import {
  RecordsFilterBar,
  applyFilters,
  EMPTY_FILTERS,
  type RecordFilters,
  type ViewMode,
} from "@/components/RecordsFilterBar";

type FeedItem =
  | { kind: "record"; createdAt: number; record: any }
  | { kind: "note"; createdAt: number; note: AppNote };

function FeedItemsList({
  items,
  view,
}: {
  items: FeedItem[];
  view: ViewMode;
}) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-2" data-testid="list-feed">
        {items.map((it) =>
          it.kind === "record" ? (
            <RecordCard key={`r-${it.record.id}`} record={it.record} variant="list" />
          ) : (
            <div key={`n-${it.note.id}`} className="max-w-lg">
              <NoteCard note={it.note} />
            </div>
          ),
        )}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-6 max-w-lg mx-auto"
      data-testid="grid-feed"
    >
      {items.map((it) =>
        it.kind === "record" ? (
          <FeedCard key={`r-${it.record.id}`} record={it.record} />
        ) : (
          <NoteCard key={`n-${it.note.id}`} note={it.note} />
        ),
      )}
    </div>
  );
}

export default function Feed() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"following" | "explore">(
    user ? "following" : "explore",
  );
  const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<ViewMode>("grid");

  const feed = useQuery({
    queryKey: ["/api/feed"],
    queryFn: () => apiFeed().then((r) => r.records),
    enabled: !!user,
  });

  const explore = useQuery({
    queryKey: ["/api/records"],
    queryFn: () => apiAllRecords().then((r) => r.records),
  });

  const notesFeed = useQuery({
    queryKey: ["/api/notes/feed"],
    queryFn: () => apiNotesFeed().then((r) => r.notes),
    enabled: !!user,
  });

  const notesExplore = useQuery({
    queryKey: ["/api/notes"],
    queryFn: () => apiListNotes().then((r) => r.notes),
  });

  const activeRaw =
    tab === "following" ? feed.data ?? [] : explore.data ?? [];
  const activeNotes =
    tab === "following" ? notesFeed.data ?? [] : notesExplore.data ?? [];
  const filteredRecords = useMemo(
    () => applyFilters(activeRaw, filters),
    [activeRaw, filters],
  );
  const mergedItems = useMemo<FeedItem[]>(() => {
    const recordItems: FeedItem[] = filteredRecords.map((r: any) => ({
      kind: "record",
      createdAt: Number(r.createdAt ?? 0),
      record: r,
    }));
    const noteItems: FeedItem[] = activeNotes.map((n) => ({
      kind: "note",
      createdAt: Number(n.createdAt ?? 0),
      note: n,
    }));
    return [...recordItems, ...noteItems].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }, [filteredRecords, activeNotes]);
  const isLoading =
    tab === "following"
      ? feed.isLoading || notesFeed.isLoading
      : explore.isLoading || notesExplore.isLoading;
  const hasAnything = activeRaw.length > 0 || activeNotes.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <header className="flex items-center justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <h1 className="font-serif text-xl font-semibold" data-testid="text-feed-title">
            Feed
          </h1>
          <p className="text-sm text-muted-foreground hidden sm:block">
            Records from naturalists you follow, and the wider community.
          </p>
        </div>
        {user && (
          <Button
            onClick={() => setLocation("/new")}
            className="shrink-0"
            data-testid="button-new-record"
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New record</span>
          </Button>
        )}
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "following" | "explore")}
        className="w-full"
      >
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid mb-4">
          <TabsTrigger
            value="following"
            disabled={!user}
            data-testid="tab-following"
          >
            <Users className="h-4 w-4 mr-2" />
            Following
          </TabsTrigger>
          <TabsTrigger value="explore" data-testid="tab-explore">
            <Compass className="h-4 w-4 mr-2" />
            Explore
          </TabsTrigger>
        </TabsList>

        <div className="mb-4">
          <RecordsFilterBar
            records={activeRaw}
            filters={filters}
            onFiltersChange={setFilters}
            view={view}
            onViewChange={setView}
            showViewToggle
            resultCount={mergedItems.length}
          />
        </div>

        <TabsContent value="following" className="mt-0">
          {!user ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-3">
                Log in to follow naturalists and build your personal feed.
              </p>
              <Button
                variant="outline"
                onClick={() => setLocation("/login")}
                data-testid="button-login-to-follow"
              >
                Log in
              </Button>
            </div>
          ) : isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !hasAnything ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <Compass className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-3">
                Your feed is empty. Follow other naturalists or post your first
                record.
              </p>
              <div className="flex justify-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => setLocation("/users")}
                  data-testid="button-find-users"
                >
                  Find users
                </Button>
                <Button
                  onClick={() => setLocation("/new")}
                  data-testid="button-new-record-empty"
                >
                  <Plus className="h-4 w-4 mr-2" /> New record
                </Button>
              </div>
            </div>
          ) : mergedItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No items match these filters.
            </div>
          ) : (
            <FeedItemsList items={mergedItems} view={view} />
          )}
        </TabsContent>

        <TabsContent value="explore" className="mt-0">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !hasAnything ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <Compass className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No community records yet — sign up and post the first one.
              </p>
            </div>
          ) : mergedItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No items match these filters.
            </div>
          ) : (
            <FeedItemsList items={mergedItems} view={view} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
