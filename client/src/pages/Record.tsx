import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MapPin,
  Calendar as CalendarIcon,
  Camera,
  Check,
  Trash2,
  HelpCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Lock,
  Copyright,
  Heart,
  MessageCircle,
  Pencil,
} from "lucide-react";
import {
  apiGetRecord,
  apiSuggestId,
  apiAcceptSuggestion,
  apiDeleteSuggestion,
  apiDeleteRecord,
  apiLikeRecord,
  apiUnlikeRecord,
  apiUpdateRecord,
  hasRoleAtLeast,
  LICENSE_OPTIONS,
  CONDITION_OPTIONS,
  BEHAVIOUR_OPTIONS,
  type AppRecord,
  type AppComment,
  type RecordEditPatch,
  type LicenseCode,
  type ConditionTag,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { BackButton } from "@/components/BackButton";
import { CommentsThread } from "@/components/CommentsThread";
import { SuggestIdDialog } from "@/components/SuggestIdDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SpeciesPicker, type PickedSpecies } from "@/components/SpeciesPicker";
import { queryClient } from "@/lib/queryClient";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RecordDetail() {
  const [, params] = useRoute("/r/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;
  const { user: viewer } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [picked, setPicked] = useState<PickedSpecies | null>(null);
  const [comment, setComment] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const q = useQuery({
    queryKey: ["/api/records", id],
    queryFn: () => apiGetRecord(id),
    enabled: !isNaN(id),
  });

  const suggestM = useMutation({
    mutationFn: async () => {
      if (!picked || !picked.scientificName) {
        throw new Error("Pick a species first");
      }
      return apiSuggestId(id, {
        speciesId: picked.taxonId,
        speciesName: picked.scientificName,
        speciesCommon: picked.commonName,
        groupKey: picked.groupKey ?? null,
        familyId: picked.familyId ?? null,
        familyName: picked.familyName ?? null,
        genus: picked.genus ?? null,
        comment: comment || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/records", id] });
      setPicked(null);
      setComment("");
      toast({ title: "Suggestion posted" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not post suggestion",
        description: err?.message || "",
        variant: "destructive",
      });
    },
  });

  const acceptM = useMutation({
    mutationFn: (sid: number) => apiAcceptSuggestion(id, sid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/records", id] });
      toast({ title: "Suggestion accepted — species updated" });
    },
  });

  const deleteSugM = useMutation({
    mutationFn: (sid: number) => apiDeleteSuggestion(id, sid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/records", id] }),
  });

  const deleteRecM = useMutation({
    mutationFn: () => apiDeleteRecord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      toast({ title: "Record deleted" });
      setLocation(viewer ? `/u/${viewer.username}` : "/");
    },
  });

  if (q.isLoading) {
    return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-muted-foreground">Loading…</div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="font-serif text-xl font-semibold">Record not found</h1>
      </div>
    );
  }

  const { record, suggestions, comments } = q.data;
  const isOwner = viewer?.id === record.userId;
  const isMod = hasRoleAtLeast(viewer, "moderator");
  const isEditorPlus = hasRoleAtLeast(viewer, "editor");
  const isAdmin = hasRoleAtLeast(viewer, "admin");
  const canEdit = isOwner || isEditorPlus;
  const canDelete = isOwner || isAdmin;
  const isUnknown = !record.speciesName;
  const cameraInfo = [record.cameraMake, record.cameraModel].filter(Boolean).join(" ");
  const shotInfo = [record.lens, record.focalLength, record.fNumber, record.shutter, record.iso ? `ISO ${record.iso}` : null]
    .filter(Boolean)
    .join(" · ");

  const photoList = (record.photos && record.photos.length > 0)
    ? record.photos
    : [record.photoDataUrl];
  const licenseLabel = LICENSE_OPTIONS.find((o) => o.value === record.licenseCode)?.short ?? null;
  const conditionOpt = CONDITION_OPTIONS.find((o) => o.value === record.conditionTag) ?? null;
  const behaviourLabel = (v: string) =>
    BEHAVIOUR_OPTIONS.find((o) => o.value === v)?.label ?? v;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="-ml-2">
        <BackButton fallback="/" label="Back" />
      </div>
      {/* Photos */}
      <PhotoCarousel photos={photoList} alt={record.speciesName || "Unknown species"} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          {isUnknown ? (
            <h1 className="font-serif text-xl font-semibold flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
              Unknown species
            </h1>
          ) : (
            <>
              {record.speciesId ? (
                <Link
                  href={`/species/${record.speciesId}`}
                  className="block hover:underline group"
                  data-testid="link-species-profile"
                >
                  <h1
                    className="font-serif text-xl font-semibold group-hover:text-primary"
                    data-testid="text-record-common"
                  >
                    {record.speciesCommon || record.speciesName}
                  </h1>
                  {record.speciesCommon && (
                    <div
                      className="italic text-muted-foreground group-hover:text-primary"
                      data-testid="text-record-sci"
                    >
                      {record.speciesName}
                    </div>
                  )}
                </Link>
              ) : (
                <>
                  <h1 className="font-serif text-xl font-semibold" data-testid="text-record-common">
                    {record.speciesCommon || record.speciesName}
                  </h1>
                  {record.speciesCommon && (
                    <div className="italic text-muted-foreground" data-testid="text-record-sci">
                      {record.speciesName}
                    </div>
                  )}
                </>
              )}
              {record.speciesId && (
                <Link
                  href={`/species/${record.speciesId}`}
                  className="text-xs text-primary underline mt-1 inline-block"
                  data-testid="link-species-guide"
                >
                  View in field guide
                </Link>
              )}
            </>
          )}
        </div>
        {record.author && (
          <Link
            href={`/u/${record.author.username}`}
            className="flex items-center gap-2 rounded-md px-2 py-1 hover-elevate shrink-0"
            data-testid="link-record-author"
          >
            <div className="w-8 h-8 rounded-full bg-muted overflow-hidden">
              {record.author.avatarDataUrl && (
                <img src={record.author.avatarDataUrl} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="text-sm">
              <div className="font-medium leading-tight">
                {record.author.displayName || record.author.username}
              </div>
              <div className="text-xs text-muted-foreground leading-tight">
                @{record.author.username}
              </div>
            </div>
          </Link>
        )}
      </div>

      {/* Notes + meta */}
      {record.notes && <p className="text-sm whitespace-pre-wrap">{record.notes}</p>}

      {/* Tags: condition, behaviour, license */}
      {(conditionOpt || (record.behaviors && record.behaviors.length > 0) || licenseLabel) && (
        <div className="flex flex-wrap gap-2 items-center" data-testid="section-record-tags">
          {conditionOpt && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground text-xs px-2.5 py-1"
              data-testid="badge-condition"
            >
              <span>{conditionOpt.icon}</span>
              {conditionOpt.label}
            </span>
          )}
          {record.behaviors?.map((b) => (
            <span
              key={b}
              className="inline-flex items-center rounded-full bg-accent text-accent-foreground text-xs px-2.5 py-1"
              data-testid={`badge-behavior-${b}`}
            >
              {behaviourLabel(b)}
            </span>
          ))}
          {licenseLabel && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border text-xs px-2.5 py-1 text-muted-foreground"
              data-testid="badge-license"
              title="Photo license"
            >
              <Copyright className="h-3 w-3" />
              {licenseLabel}
            </span>
          )}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        {record.placeGuess && (
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div>{record.placeGuess}</div>
              {record.lat && record.lng && (
                <div className="text-xs text-muted-foreground">
                  {parseFloat(record.lat).toFixed(4)}, {parseFloat(record.lng).toFixed(4)}
                </div>
              )}
              {record.obscured && (
                <div
                  className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5"
                  data-testid="text-obscured"
                >
                  <Lock className="h-3 w-3" />
                  Location obscured to ~10 km
                </div>
              )}
              {!record.obscured && record.obscureLocation && isOwner && (
                <div
                  className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5"
                  data-testid="text-obscured-owner"
                >
                  <Lock className="h-3 w-3" />
                  Public viewers see this location fuzzed to ~10 km
                </div>
              )}
            </div>
          </div>
        )}
        {record.observedOn && (
          <div className="flex items-start gap-2">
            <CalendarIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>Observed on {record.observedOn}</div>
          </div>
        )}
        {(cameraInfo || shotInfo) && (
          <div className="flex items-start gap-2 sm:col-span-2">
            <Camera className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              {cameraInfo && <div>{cameraInfo}</div>}
              {shotInfo && <div className="text-xs text-muted-foreground">{shotInfo}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Posted {formatTimestamp(record.createdAt)}
      </div>

      {/* Like / comment / edit / delete actions */}
      <RecordActionsBar
        record={record}
        commentCount={comments?.length ?? record.commentCount}
        canEdit={canEdit}
        canDelete={canDelete}
        isOwner={isOwner}
        onDelete={() => setDeleteOpen(true)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-record">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The photos, location, comments and any
              suggested IDs attached to this sighting will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-record">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDeleteOpen(false);
                deleteRecM.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-record"
            >
              {deleteRecM.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Comments */}
      <CommentsThread
        recordId={record.id}
        comments={comments ?? []}
        isOwner={isOwner}
        canModerate={isMod}
        invalidateKeys={[["/api/records", record.id], ["/api/records"], ["/api/feed"]]}
      />

      {/* Suggestions */}
      <section>
        <h2 className="font-serif text-lg font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          ID suggestions {suggestions.length > 0 && <span className="text-muted-foreground">({suggestions.length})</span>}
        </h2>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground mb-4">
            {isUnknown
              ? "No suggestions yet. Be the first to help identify this species."
              : "No alternative IDs suggested."}
          </p>
        ) : (
          <ul className="space-y-3 mb-6">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-border bg-card p-3"
                data-testid={`suggestion-${s.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {s.speciesId ? (
                      <Link
                        href={`/species/${s.speciesId}`}
                        className="hover:underline"
                        data-testid={`link-sug-species-${s.id}`}
                      >
                        <div className="font-medium" data-testid={`text-sug-name-${s.id}`}>
                          {s.speciesCommon || s.speciesName}
                        </div>
                        {s.speciesCommon && (
                          <div className="text-xs italic text-muted-foreground">{s.speciesName}</div>
                        )}
                      </Link>
                    ) : (
                      <>
                    <div className="font-medium" data-testid={`text-sug-name-${s.id}`}>
                      {s.speciesCommon || s.speciesName}
                    </div>
                    {s.speciesCommon && (
                      <div className="text-xs italic text-muted-foreground">{s.speciesName}</div>
                    )}
                      </>
                    )}
                    {s.comment && (
                      <p className="mt-1.5 text-sm">{s.comment}</p>
                    )}
                    {s.user && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Suggested by{" "}
                        <Link href={`/u/${s.user.username}`} className="text-primary underline">
                          {s.user.displayName || s.user.username}
                        </Link>
                        {" "}· {formatTimestamp(s.createdAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {isOwner && (
                      <Button
                        size="sm"
                        onClick={() => acceptM.mutate(s.id)}
                        disabled={acceptM.isPending}
                        data-testid={`button-accept-${s.id}`}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" /> Accept
                      </Button>
                    )}
                    {(isOwner || (viewer && s.user && viewer.id === s.user.id)) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteSugM.mutate(s.id)}
                        data-testid={`button-delete-sug-${s.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Suggest form */}
        {viewer && !isOwner && (
          <div className="rounded-md border border-border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Suggest an ID</div>
            <SpeciesPicker value={picked} onChange={setPicked} allowUnknown={false} />
            <div>
              <Label htmlFor="comment">Comment (optional)</Label>
              <Textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Why you think it's this species…"
                data-testid="input-suggestion-comment"
              />
            </div>
            <Button
              onClick={() => suggestM.mutate()}
              disabled={!picked || suggestM.isPending}
              data-testid="button-submit-suggestion"
            >
              {suggestM.isPending ? "Posting…" : "Post suggestion"}
            </Button>
          </div>
        )}
        {!viewer && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground text-center">
            <Link href="/login" className="text-primary underline">
              Log in
            </Link>{" "}
            to suggest an ID.
          </div>
        )}
      </section>
    </div>
  );
}

function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  if (!photos || photos.length === 0) return null;
  const safeIdx = Math.min(Math.max(0, idx), photos.length - 1);
  const single = photos.length === 1;
  return (
    <div className="space-y-2" data-testid="section-photo-carousel">
      <div className="rounded-md overflow-hidden bg-card border border-border relative">
        <img
          src={photos[safeIdx]}
          alt={alt}
          className="w-full max-h-[70vh] object-contain bg-muted"
          data-testid={`img-record-photo-${safeIdx}`}
        />
        {!single && (
          <>
            <button
              type="button"
              onClick={() => setIdx((safeIdx - 1 + photos.length) % photos.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/85 hover:bg-background flex items-center justify-center"
              aria-label="Previous photo"
              data-testid="button-photo-prev"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setIdx((safeIdx + 1) % photos.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/85 hover:bg-background flex items-center justify-center"
              aria-label="Next photo"
              data-testid="button-photo-next"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[11px] bg-background/85">
              {safeIdx + 1} / {photos.length}
            </div>
          </>
        )}
      </div>
      {!single && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              className={
                "shrink-0 h-16 w-16 rounded overflow-hidden border-2 " +
                (i === safeIdx ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")
              }
              data-testid={`button-photo-thumb-${i}`}
            >
              <img src={p} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────── Like + edit + delete actions ────────────────────────
function RecordActionsBar({
  record,
  commentCount,
  canEdit,
  canDelete,
  isOwner,
  onDelete,
}: {
  record: AppRecord;
  commentCount: number;
  canEdit: boolean;
  canDelete: boolean;
  isOwner: boolean;
  onDelete: () => void;
}) {
  const { user: viewer } = useAuth();
  const [optimistic, setOptimistic] = useState<{
    liked: boolean;
    count: number;
  } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const liked = optimistic?.liked ?? record.likedByMe;
  const likeCount = optimistic?.count ?? record.likeCount;

  const likeMut = useMutation({
    mutationFn: async () => {
      if (liked) return apiUnlikeRecord(record.id);
      return apiLikeRecord(record.id);
    },
    onMutate: () => {
      setOptimistic({
        liked: !liked,
        count: Math.max(0, likeCount + (liked ? -1 : 1)),
      });
    },
    onSuccess: (data) => {
      setOptimistic({ liked: data.liked, count: data.likeCount });
      queryClient.invalidateQueries({ queryKey: ["/api/records", record.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      if (record.speciesId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/species", record.speciesId, "top-photo"],
        });
      }
    },
    onError: () => {
      setOptimistic({ liked: record.likedByMe, count: record.likeCount });
    },
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-t border-b border-border py-3">
        <Button
          variant={liked ? "default" : "outline"}
          size="sm"
          onClick={() => {
            if (!viewer) return;
            likeMut.mutate();
          }}
          disabled={!viewer || likeMut.isPending}
          data-testid="button-like"
          aria-pressed={liked}
        >
          <Heart
            className={
              "h-4 w-4 mr-1.5 " + (liked ? "fill-current" : "")
            }
          />
          {likeCount} {likeCount === 1 ? "like" : "likes"}
        </Button>
        <div
          className="inline-flex items-center text-sm text-muted-foreground px-2"
          data-testid="text-comment-count"
        >
          <MessageCircle className="h-4 w-4 mr-1.5" />
          {commentCount} {commentCount === 1 ? "comment" : "comments"}
        </div>
        {viewer && !isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSuggestOpen(true)}
            data-testid="button-suggest-id"
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            Suggest ID
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              data-testid="button-edit-record"
            >
              <Pencil className="h-4 w-4 mr-1.5" /> Edit
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              data-testid="button-delete-record"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {isOwner ? "Delete" : "Delete (admin)"}
            </Button>
          )}
        </div>
      </div>
      <EditRecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        record={record}
      />
      <SuggestIdDialog
        recordId={record.id}
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        invalidateKeys={[
          ["/api/records", record.id],
          ["/api/records"],
          ["/api/feed"],
        ]}
      />
    </>
  );
}

// ──────────────────────── Edit record dialog ────────────────────────
function EditRecordDialog({
  open,
  onOpenChange,
  record,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: AppRecord;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(record.notes ?? "");
  const [placeGuess, setPlaceGuess] = useState(record.placeGuess ?? "");
  const [observedOn, setObservedOn] = useState(record.observedOn ?? "");
  const [lat, setLat] = useState(record.lat ?? "");
  const [lng, setLng] = useState(record.lng ?? "");
  const [obscure, setObscure] = useState(record.obscureLocation);
  const [licenseCode, setLicenseCode] = useState<LicenseCode | "">(
    record.licenseCode ?? "",
  );
  const [conditionTag, setConditionTag] = useState<ConditionTag | "">(
    record.conditionTag ?? "",
  );
  const [behaviors, setBehaviors] = useState<string[]>(record.behaviors ?? []);
  const [picked, setPicked] = useState<PickedSpecies | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const patch: RecordEditPatch = {
        notes: notes || null,
        placeGuess: placeGuess || null,
        observedOn: observedOn || null,
        lat: lat || null,
        lng: lng || null,
        obscureLocation: obscure,
        licenseCode: (licenseCode || null) as LicenseCode | null,
        conditionTag: (conditionTag || null) as ConditionTag | null,
        behaviors,
      };
      if (picked) {
        patch.speciesId = picked.taxonId ?? null;
        patch.speciesName = picked.scientificName;
        patch.speciesCommon = picked.commonName ?? null;
        patch.groupKey = picked.groupKey ?? null;
        patch.familyId = picked.familyId ?? null;
        patch.familyName = picked.familyName ?? null;
        patch.genus = picked.genus ?? null;
      }
      return apiUpdateRecord(record.id, patch);
    },
    onSuccess: () => {
      toast({ title: "Record updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/records", record.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      if (record.speciesId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/species", record.speciesId, "top-photo"],
        });
      }
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Could not update record",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const toggleBehavior = (v: string) => {
    setBehaviors((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit record</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Species
            </Label>
            <div className="mt-1">
              <SpeciesPicker
                value={picked}
                onChange={setPicked}
                allowUnknown={true}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Current:{" "}
              {record.speciesCommon || record.speciesName || "Unknown"}
              {picked ? " → " + (picked.commonName || picked.scientificName) : ""}
            </p>
          </div>

          <div>
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              data-testid="input-edit-notes"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-place">Place</Label>
              <Input
                id="edit-place"
                value={placeGuess}
                onChange={(e) => setPlaceGuess(e.target.value)}
                data-testid="input-edit-place"
              />
            </div>
            <div>
              <Label htmlFor="edit-date">Observed on</Label>
              <Input
                id="edit-date"
                type="date"
                value={observedOn}
                onChange={(e) => setObservedOn(e.target.value)}
                data-testid="input-edit-date"
              />
            </div>
            <div>
              <Label htmlFor="edit-lat">Latitude</Label>
              <Input
                id="edit-lat"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-27.4698"
                data-testid="input-edit-lat"
              />
            </div>
            <div>
              <Label htmlFor="edit-lng">Longitude</Label>
              <Input
                id="edit-lng"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="153.0251"
                data-testid="input-edit-lng"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={obscure}
              onCheckedChange={(v) => setObscure(!!v)}
              data-testid="check-edit-obscure"
            />
            Obscure location to ~10 km for non-owners
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Condition</Label>
              <Select
                value={conditionTag || "none"}
                onValueChange={(v) =>
                  setConditionTag(v === "none" ? "" : (v as ConditionTag))
                }
              >
                <SelectTrigger data-testid="select-edit-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {CONDITION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.icon} {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Photo license</Label>
              <Select
                value={licenseCode || "none"}
                onValueChange={(v) =>
                  setLicenseCode(v === "none" ? "" : (v as LicenseCode))
                }
              >
                <SelectTrigger data-testid="select-edit-license">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No license specified</SelectItem>
                  {LICENSE_OPTIONS.filter((o) => o.value !== "none").map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.short}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Behaviours
            </Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BEHAVIOUR_OPTIONS.map((b) => {
                const active = behaviors.includes(b.value);
                return (
                  <button
                    type="button"
                    key={b.value}
                    onClick={() => toggleBehavior(b.value)}
                    className={
                      "px-2.5 py-1 rounded-full text-xs border " +
                      (active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-accent")
                    }
                    data-testid={`toggle-edit-behavior-${b.value}`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            data-testid="button-edit-save"
          >
            {mut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

