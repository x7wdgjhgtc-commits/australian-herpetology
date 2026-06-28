import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  UserPlus,
  UserMinus,
  Settings,
  Plus,
  Users as UsersIcon,
  Globe,
  MapPin,
  Instagram,
  Twitter,
  Facebook,
} from "lucide-react";
import { useMemo, useState } from "react";
import { apiGetUser, apiGetUserRecords, apiFollow, apiUnfollow, apiNotesForUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { RecordCard } from "@/components/RecordCard";
import { NoteCard } from "@/components/NoteCard";
import { queryClient } from "@/lib/queryClient";
import { SpeciesTally } from "@/components/SpeciesTally";
import { UserRankings } from "@/components/UserRankings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AdminBadge } from "@/components/AdminBadge";
import {
  RecordsFilterBar,
  applyFilters,
  EMPTY_FILTERS,
  type RecordFilters,
  type ViewMode,
} from "@/components/RecordsFilterBar";

function normalizeUrl(u: string): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

function facebookUrl(v: string): string {
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  // strip leading @ if user typed one
  const handle = v.replace(/^@/, "").replace(/^facebook\.com\//, "");
  return `https://facebook.com/${handle}`;
}

export default function Profile() {
  const [, params] = useRoute("/u/:username");
  const username = params?.username || "";
  const { user: viewer } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const userQuery = useQuery({
    queryKey: ["/api/users", username],
    queryFn: () => apiGetUser(username).then((r) => r.user),
    enabled: !!username,
  });

  const recordsQuery = useQuery({
    queryKey: ["/api/users", username, "records"],
    queryFn: () => apiGetUserRecords(username).then((r) => r.records),
    enabled: !!username,
  });

  const followM = useMutation({
    mutationFn: async () => {
      if (!userQuery.data) return;
      if (userQuery.data.isFollowing) return apiUnfollow(username);
      return apiFollow(username);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", username] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not update follow",
        description: err?.message || "",
        variant: "destructive",
      });
    },
  });

  const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<ViewMode>("grid");
  const records = recordsQuery.data ?? [];
  const filtered = useMemo(() => applyFilters(records, filters), [records, filters]);

  if (userQuery.isLoading) {
    return <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 text-muted-foreground">Loading…</div>;
  }
  if (userQuery.isError || !userQuery.data) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="font-serif text-xl font-semibold mb-2">User not found</h1>
        <p className="text-sm text-muted-foreground">No user with that username.</p>
      </div>
    );
  }

  const u = userQuery.data;
  const isSelf = viewer?.id === u.id;

  const hasContact =
    !!u.website || !!u.location || !!u.instagram || !!u.twitter || !!u.facebook;

  return (
    <div className="max-w-4xl mx-auto pb-8">
      {/* Cover photo banner */}
      <div className="relative z-0 h-40 sm:h-56 w-full overflow-hidden bg-gradient-to-br from-primary/20 via-muted to-muted/40 sm:rounded-b-lg">
        {u.coverDataUrl && (
          <img
            src={u.coverDataUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: u.coverPos || "50% 50%" }}
            data-testid="img-cover"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
      </div>

      {/* Profile header — avatar overlaps cover */}
      <div className="relative z-10 px-4 sm:px-6">
        <header className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6 -mt-12 sm:-mt-14">
          <div className="relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-muted overflow-hidden shrink-0 ring-4 ring-background border border-border">
            {u.avatarDataUrl ? (
              <img
                src={u.avatarDataUrl}
                alt=""
                className="w-full h-full object-cover"
                style={{ objectPosition: u.avatarPos || "50% 50%" }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl font-serif text-muted-foreground">
                {(u.displayName || u.username).charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 sm:pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="font-serif text-xl font-semibold truncate"
                data-testid="text-profile-name"
              >
                {u.displayName || u.username}
              </h1>
              <AdminBadge user={u} />
            </div>
            <div className="text-sm text-muted-foreground">@{u.username}</div>
          </div>

          <div className="flex items-center gap-2 shrink-0 sm:pb-2">
            {isSelf ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/me/edit")}
                  data-testid="button-edit-profile"
                >
                  <Settings className="h-4 w-4 mr-2" /> Edit profile
                </Button>
                <Button
                  size="sm"
                  onClick={() => setLocation("/new")}
                  data-testid="button-new-record"
                >
                  <Plus className="h-4 w-4 mr-2" /> New record
                </Button>
              </>
            ) : viewer ? (
              <Button
                variant={u.isFollowing ? "outline" : "default"}
                size="sm"
                onClick={() => followM.mutate()}
                disabled={followM.isPending}
                data-testid="button-toggle-follow"
              >
                {u.isFollowing ? (
                  <>
                    <UserMinus className="h-4 w-4 mr-2" /> Unfollow
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" /> Follow
                  </>
                )}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setLocation("/login")}>
                <UserPlus className="h-4 w-4 mr-2" /> Log in to follow
              </Button>
            )}
          </div>
        </header>

        {/* Bio + contact */}
        <div className="mt-4 space-y-2">
          {u.bio && (
            <p className="text-sm leading-relaxed" data-testid="text-profile-bio">
              {u.bio}
            </p>
          )}

          {hasContact && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              {u.location && (
                <span className="inline-flex items-center gap-1.5" data-testid="text-location">
                  <MapPin className="h-3.5 w-3.5" />
                  {u.location}
                </span>
              )}
              {u.website && (
                <a
                  href={normalizeUrl(u.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-foreground hover:underline"
                  data-testid="link-website"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {u.website.replace(/^https?:\/\//i, "")}
                </a>
              )}
              {u.instagram && (
                <a
                  href={`https://instagram.com/${u.instagram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-foreground hover:underline"
                  data-testid="link-instagram"
                >
                  <Instagram className="h-3.5 w-3.5" />@{u.instagram}
                </a>
              )}
              {u.twitter && (
                <a
                  href={`https://x.com/${u.twitter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-foreground hover:underline"
                  data-testid="link-twitter"
                >
                  <Twitter className="h-3.5 w-3.5" />@{u.twitter}
                </a>
              )}
              {u.facebook && (
                <a
                  href={facebookUrl(u.facebook)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-foreground hover:underline"
                  data-testid="link-facebook"
                >
                  <Facebook className="h-3.5 w-3.5" />
                  Facebook
                </a>
              )}
            </div>
          )}

          {/* Counters */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 text-sm">
            <span>
              <strong>{u.recordCount ?? 0}</strong>{" "}
              <span className="text-muted-foreground">records</span>
            </span>
            <Link
              href={`/u/${u.username}/followers`}
              className="hover-elevate rounded-md px-1.5 -mx-1.5"
            >
              <strong>{u.followerCount ?? 0}</strong>{" "}
              <span className="text-muted-foreground">followers</span>
            </Link>
            <Link
              href={`/u/${u.username}/following`}
              className="hover-elevate rounded-md px-1.5 -mx-1.5"
            >
              <strong>{u.followingCount ?? 0}</strong>{" "}
              <span className="text-muted-foreground">following</span>
            </Link>
          </div>
        </div>

        {/* Leaderboard rankings */}
        <div className="mt-6">
          <UserRankings username={u.username} />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="records" className="mt-6">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger
              value="records"
              className="flex-1 sm:flex-none"
              data-testid="tab-records"
            >
              Records
            </TabsTrigger>
            <TabsTrigger
              value="notes"
              className="flex-1 sm:flex-none"
              data-testid="tab-notes"
            >
              Observation notes
            </TabsTrigger>
            <TabsTrigger
              value="tally"
              className="flex-1 sm:flex-none"
              data-testid="tab-tally"
            >
              Species tally
            </TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="mt-5">
            {recordsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : records.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center">
                {isSelf ? (
                  <>
                    <UsersIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-3">
                      No records yet. Add your first sighting.
                    </p>
                    <Button onClick={() => setLocation("/new")}>
                      <Plus className="h-4 w-4 mr-2" /> New record
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No records yet.</p>
                )}
              </div>
            ) : (
              <>
                <RecordsFilterBar
                  records={records}
                  filters={filters}
                  onFiltersChange={setFilters}
                  view={view}
                  onViewChange={setView}
                  resultCount={filtered.length}
                />
                {filtered.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No records match the current filters.
                  </div>
                ) : view === "list" ? (
                  <div className="flex flex-col gap-2">
                    {filtered.map((r) => (
                      <RecordCard
                        key={r.id}
                        record={r}
                        showAuthor={false}
                        variant="list"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {filtered.map((r) => (
                      <RecordCard key={r.id} record={r} showAuthor={false} />
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-5">
            <NotesTab username={u.username} isSelf={isSelf} />
          </TabsContent>

          <TabsContent value="tally" className="mt-5">
            <SpeciesTally username={u.username} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function NotesTab({ username, isSelf }: { username: string; isSelf: boolean }) {
  const [, setLocation] = useLocation();
  const q = useQuery({
    queryKey: ["/api/users", username, "notes"],
    queryFn: () => apiNotesForUser(username).then((r) => r.notes),
  });
  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const notes = q.data ?? [];
  if (notes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        {isSelf ? (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              No observation notes yet. Share a behavioural or scientific note.
            </p>
            <Button
              onClick={() => setLocation("/notes/new")}
              data-testid="button-new-note-empty"
            >
              <Plus className="h-4 w-4 mr-2" /> Write a note
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No observation notes yet.</p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6 max-w-lg mx-auto" data-testid="list-user-notes">
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} />
      ))}
    </div>
  );
}
