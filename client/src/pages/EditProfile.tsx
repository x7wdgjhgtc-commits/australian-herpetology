import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Loader2,
  Camera,
  ImagePlus,
  Globe,
  MapPin,
  Instagram,
  Twitter,
  Facebook,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  apiUpdateMe,
  apiGetInatStatus,
  apiConnectInat,
  apiSyncInat,
  apiDisconnectInat,
} from "@/lib/api";
import { fileToResizedDataUrl } from "@/lib/photo";
import { ImagePositioner } from "@/components/ImagePositioner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export default function EditProfile() {
  const { user, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [avatarPos, setAvatarPos] = useState<string | null>(null);
  const [coverPos, setCoverPos] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const [location, setLocationField] = useState("");
  const [instagram, setInstagram] = useState("");
  const [twitter, setTwitter] = useState("");
  const [facebook, setFacebook] = useState("");
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [processingCover, setProcessingCover] = useState(false);

  useEffect(() => {
    if (!user) {
      setLocation("/login");
      return;
    }
    setDisplayName(user.displayName ?? "");
    setBio(user.bio ?? "");
    setAvatar(user.avatarDataUrl ?? null);
    setCover(user.coverDataUrl ?? null);
    setAvatarPos(user.avatarPos ?? null);
    setCoverPos(user.coverPos ?? null);
    setWebsite(user.website ?? "");
    setLocationField(user.location ?? "");
    setInstagram(user.instagram ?? "");
    setTwitter(user.twitter ?? "");
    setFacebook(user.facebook ?? "");
  }, [user, setLocation]);

  const save = useMutation({
    mutationFn: () =>
      apiUpdateMe({
        displayName: displayName || null,
        bio: bio || null,
        avatarDataUrl: avatar,
        coverDataUrl: cover,
        avatarPos: avatar ? avatarPos : null,
        coverPos: cover ? coverPos : null,
        website: website.trim() || null,
        location: location.trim() || null,
        instagram: instagram.trim() || null,
        twitter: twitter.trim() || null,
        facebook: facebook.trim() || null,
      }),
    onSuccess: async () => {
      toast({ title: "Profile updated" });
      await refresh();
      if (user) {
        queryClient.invalidateQueries({ queryKey: ["/api/users", user.username] });
      }
      setLocation(user ? `/u/${user.username}` : "/");
    },
    onError: (err: any) => {
      toast({
        title: "Could not update profile",
        description: err?.message || "",
        variant: "destructive",
      });
    },
  });

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingAvatar(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file, 400, 0.85);
      setAvatar(dataUrl);
      // Reset position when a new image is picked.
      setAvatarPos("50% 50%");
    } finally {
      setProcessingAvatar(false);
    }
    // Allow re-picking the same file.
    e.target.value = "";
  }

  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingCover(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file, 1600, 0.82);
      setCover(dataUrl);
      setCoverPos("50% 50%");
    } finally {
      setProcessingCover(false);
    }
    e.target.value = "";
  }

  if (!user) return null;

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-serif text-xl font-semibold mb-6">Edit profile</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-6"
      >
        {/* Cover photo */}
        <div>
          <Label>Cover photo</Label>
          {cover ? (
            <div className="mt-1.5">
              <ImagePositioner
                src={cover}
                position={coverPos}
                onChange={setCoverPos}
                aspect="16 / 6"
                testId="positioner-cover"
              />
              <div className="flex items-center gap-3 mt-2">
                <label className="text-xs underline cursor-pointer text-muted-foreground" data-testid="button-replace-cover">
                  Replace photo
                  <input type="file" accept="image/*" onChange={onCoverChange} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => { setCover(null); setCoverPos(null); }}
                  className="text-xs text-muted-foreground underline"
                  data-testid="button-clear-cover"
                >
                  Remove cover photo
                </button>
              </div>
              {processingCover && (
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Processing…
                </div>
              )}
            </div>
          ) : (
            <label
              className="relative mt-1.5 w-full block rounded-lg overflow-hidden border border-border bg-gradient-to-br from-muted to-muted/40 cursor-pointer"
              style={{ aspectRatio: "16 / 6" }}
              data-testid="input-cover-label"
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-1">
                <ImagePlus className="h-5 w-5" />
                <span className="text-xs">Tap to add a cover photo</span>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={onCoverChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
                data-testid="input-cover"
              />
              {processingCover && (
                <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </label>
          )}
        </div>

        {/* Avatar */}
        <div className="flex items-start gap-4">
          {avatar ? (
            <div className="w-32 shrink-0">
              <ImagePositioner
                src={avatar}
                position={avatarPos}
                onChange={setAvatarPos}
                aspect="1 / 1"
                rounded="rounded-full"
                testId="positioner-avatar"
              />
            </div>
          ) : (
            <label
              className="relative w-20 h-20 rounded-full bg-muted overflow-hidden border border-border shrink-0 cursor-pointer block"
              data-testid="input-avatar-label"
            >
              <Camera className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" />
              <input
                type="file"
                accept="image/*"
                onChange={onAvatarChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
                data-testid="input-avatar"
              />
              {processingAvatar && (
                <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </label>
          )}
          <div className="text-sm flex-1">
            <div className="font-medium">Avatar</div>
            {avatar ? (
              <>
                <div className="text-muted-foreground text-xs">Drag the photo to reposition.</div>
                <div className="flex items-center gap-3 mt-1">
                  <label className="text-xs underline cursor-pointer text-muted-foreground" data-testid="button-replace-avatar">
                    Replace photo
                    <input type="file" accept="image/*" onChange={onAvatarChange} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={() => { setAvatar(null); setAvatarPos(null); }}
                    className="text-xs text-muted-foreground underline"
                    data-testid="button-clear-avatar"
                  >
                    Remove
                  </button>
                </div>
                {processingAvatar && (
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Processing…
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground">Tap to add a photo</div>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="input-display-name"
          />
        </div>
        <div>
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="A short bio…"
            data-testid="input-bio"
          />
          <div className="text-xs text-muted-foreground mt-1 text-right">
            {bio.length}/500
          </div>
        </div>

        {/* Contact info */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">Contact &amp; links</div>

          <div>
            <Label htmlFor="location" className="flex items-center gap-1.5 text-xs">
              <MapPin className="h-3.5 w-3.5" /> Location
            </Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocationField(e.target.value)}
              placeholder="Brisbane, Queensland"
              data-testid="input-location"
            />
          </div>

          <div>
            <Label htmlFor="website" className="flex items-center gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" /> Website
            </Label>
            <Input
              id="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              data-testid="input-website"
            />
          </div>

          <div>
            <Label htmlFor="instagram" className="flex items-center gap-1.5 text-xs">
              <Instagram className="h-3.5 w-3.5" /> Instagram
            </Label>
            <Input
              id="instagram"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value.replace(/^@/, ""))}
              placeholder="username (no @)"
              data-testid="input-instagram"
            />
          </div>

          <div>
            <Label htmlFor="twitter" className="flex items-center gap-1.5 text-xs">
              <Twitter className="h-3.5 w-3.5" /> X / Twitter
            </Label>
            <Input
              id="twitter"
              value={twitter}
              onChange={(e) => setTwitter(e.target.value.replace(/^@/, ""))}
              placeholder="username (no @)"
              data-testid="input-twitter"
            />
          </div>

          <div>
            <Label htmlFor="facebook" className="flex items-center gap-1.5 text-xs">
              <Facebook className="h-3.5 w-3.5" /> Facebook
            </Label>
            <Input
              id="facebook"
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              placeholder="username or profile URL"
              data-testid="input-facebook"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={save.isPending} data-testid="button-save-profile">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setLocation(`/u/${user.username}`)}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
        </div>
      </form>

      <InatConnectionCard />
    </div>
  );
}

// ───────── iNaturalist connection ─────────

function InatConnectionCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{
    inatUsername: string | null;
    inatLastImportAt: number | null;
  } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [usernameInput, setUsernameInput] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [lastSummary, setLastSummary] = useState<{
    scanned: number;
    imported: number;
    skipped: number;
    failed: number;
  } | null>(null);

  // Threshold for silent client-side auto-sync when the user opens this page.
  // The server also auto-syncs hourly in the background — this just catches
  // up sooner when someone is actively looking at their profile.
  const CLIENT_AUTOSYNC_STALE_MS = 10 * 60 * 1000;

  useEffect(() => {
    let cancelled = false;
    apiGetInatStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        // If connected and last import is older than the stale threshold,
        // kick off a silent background sync. No toast on success — just
        // refresh the records and feed queries when it finishes.
        const stale =
          !!s.inatUsername &&
          (!s.inatLastImportAt ||
            Date.now() - s.inatLastImportAt > CLIENT_AUTOSYNC_STALE_MS);
        if (stale) {
          setAutoSyncing(true);
          apiSyncInat()
            .then((result) => {
              if (cancelled) return;
              setStatus({
                inatUsername: result.inatUsername,
                inatLastImportAt: result.inatLastImportAt,
              });
              setLastSummary({
                scanned: result.summary.scanned,
                imported: result.summary.imported,
                skipped: result.summary.skipped,
                failed: result.summary.failed,
              });
              invalidateRecords();
              // Only show a toast when fresh records actually came in.
              if (result.summary.imported > 0) {
                toast({
                  title: "New iNaturalist records imported",
                  description: `Added ${result.summary.imported} new observation${
                    result.summary.imported === 1 ? "" : "s"
                  } from @${result.inatUsername}.`,
                });
              }
            })
            .catch(() => {
              // Silent: don't alarm the user when a background sync fails.
            })
            .finally(() => {
              if (!cancelled) setAutoSyncing(false);
            });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ inatUsername: null, inatLastImportAt: null });
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function invalidateRecords() {
    queryClient.invalidateQueries({ queryKey: ["/api/records"] });
    queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
  }

  async function handleConnect() {
    const u = usernameInput.trim().replace(/^@/, "");
    if (!u) {
      toast({ title: "Enter your iNaturalist username", variant: "destructive" });
      return;
    }
    setBusy("connect");
    try {
      const result = await apiConnectInat(u);
      setStatus({
        inatUsername: result.inatUsername,
        inatLastImportAt: result.inatLastImportAt,
      });
      setLastSummary({
        scanned: result.summary.scanned,
        imported: result.summary.imported,
        skipped: result.summary.skipped,
        failed: result.summary.failed,
      });
      setUsernameInput("");
      invalidateRecords();
      toast({
        title: "iNaturalist connected",
        description: `Imported ${result.summary.imported} record${
          result.summary.imported === 1 ? "" : "s"
        }, skipped ${result.summary.skipped} duplicate${
          result.summary.skipped === 1 ? "" : "s"
        }.`,
      });
    } catch (err: any) {
      toast({
        title: "Could not connect iNaturalist",
        description: err?.message || "Check the username and try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy("sync");
    try {
      const result = await apiSyncInat();
      setStatus({
        inatUsername: result.inatUsername,
        inatLastImportAt: result.inatLastImportAt,
      });
      setLastSummary({
        scanned: result.summary.scanned,
        imported: result.summary.imported,
        skipped: result.summary.skipped,
        failed: result.summary.failed,
      });
      invalidateRecords();
      toast({
        title: "iNaturalist synced",
        description: `Imported ${result.summary.imported}, skipped ${result.summary.skipped}.`,
      });
    } catch (err: any) {
      toast({
        title: "Sync failed",
        description: err?.message || "",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      await apiDisconnectInat();
      setStatus({ inatUsername: null, inatLastImportAt: null });
      setLastSummary(null);
      toast({
        title: "iNaturalist disconnected",
        description: "Your imported records were kept on your profile.",
      });
    } catch (err: any) {
      toast({
        title: "Could not disconnect",
        description: err?.message || "",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  const isConnected = !!status?.inatUsername;
  const lastImport = status?.inatLastImportAt
    ? new Date(status.inatLastImportAt).toLocaleString()
    : null;

  return (
    <section
      className="mt-8 rounded-lg border border-border bg-card p-4 sm:p-5"
      data-testid="section-inat"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-10 w-10 rounded-md bg-[#74AC00] text-white flex items-center justify-center font-bold text-sm">
          iN
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">iNaturalist</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect your iNaturalist account to import your public reptile and amphibian
            observations. Existing records are matched, not duplicated.
          </p>

          {loadingStatus ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : isConnected ? (
            <div className="mt-3 space-y-2 text-sm">
              <div>
                Connected as{" "}
                <a
                  href={`https://www.inaturalist.org/people/${status!.inatUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-dotted"
                  data-testid="link-inat-profile"
                >
                  @{status!.inatUsername}
                </a>
              </div>
              {lastImport && (
                <div
                  className="text-xs text-muted-foreground"
                  data-testid="text-inat-last-import"
                >
                  Last synced: {lastImport}
                </div>
              )}
              <div
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                data-testid="text-inat-auto-sync"
              >
                {autoSyncing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking iNaturalist for new observations…
                  </>
                ) : (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#74AC00]" />
                    Auto-sync on · checks hourly
                  </>
                )}
              </div>
              {lastSummary && (
                <div
                  className="text-xs text-muted-foreground"
                  data-testid="text-inat-last-summary"
                >
                  Last run: scanned {lastSummary.scanned}, imported {lastSummary.imported},
                  skipped {lastSummary.skipped}
                  {lastSummary.failed ? `, failed ${lastSummary.failed}` : ""}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSync}
                  disabled={busy !== null}
                  data-testid="button-inat-sync"
                >
                  {busy === "sync" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Syncing…
                    </>
                  ) : (
                    "Sync now"
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={busy !== null}
                  data-testid="button-inat-disconnect"
                >
                  {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <Label htmlFor="inat-username" className="text-xs">
                iNaturalist username
              </Label>
              <div className="flex gap-2">
                <Input
                  id="inat-username"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleConnect();
                    }
                  }}
                  placeholder="your-inat-username"
                  disabled={busy !== null}
                  data-testid="input-inat-username"
                />
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={busy !== null || !usernameInput.trim()}
                  data-testid="button-inat-connect"
                >
                  {busy === "connect" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                We&apos;ll scan public reptile and amphibian observations only.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
