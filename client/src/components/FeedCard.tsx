import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  MapPin,
  HelpCircle,
  Images,
  Lock,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import {
  apiLikeRecord,
  apiUnlikeRecord,
  apiListComments,
  type AppRecord,
  type AppComment,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { CommentsThread } from "@/components/CommentsThread";
import { SuggestIdDialog } from "@/components/SuggestIdDialog";
import { cn } from "@/lib/utils";
import { AdminBadge } from "@/components/AdminBadge";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function FeedPhotoCarousel({
  photos,
  alt,
  onDoubleClick,
}: {
  photos: string[];
  alt: string;
  onDoubleClick?: () => void;
}) {
  const [idx, setIdx] = useState(0);
  // Per-photo natural aspect ratio (width / height). Undefined until loaded.
  const [ratios, setRatios] = useState<Record<number, number>>({});
  if (!photos || photos.length === 0) return null;
  const safeIdx = Math.min(Math.max(0, idx), photos.length - 1);
  const single = photos.length === 1;
  const currentRatio = ratios[safeIdx];
  // Clamp to sensible bounds so ultra-wide or ultra-tall images don’t blow out.
  // 4:5 portrait (0.8) on the tall end, 1.91:1 landscape on the wide end.
  const clampedRatio = currentRatio
    ? Math.min(Math.max(currentRatio, 0.8), 1.91)
    : undefined;
  return (
    <div
      className="relative bg-black"
      onDoubleClick={onDoubleClick}
      data-testid="feed-photo-carousel"
    >
      <div
        className="relative w-full overflow-hidden"
        style={{
          aspectRatio: clampedRatio ?? 1,
        }}
      >
        <img
          src={photos[safeIdx]}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              const r = img.naturalWidth / img.naturalHeight;
              setRatios((prev) =>
                prev[safeIdx] === r ? prev : { ...prev, [safeIdx]: r },
              );
            }
          }}
        />
      </div>
      {!single && (
        <>
          {safeIdx > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIdx(safeIdx - 1);
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/70 backdrop-blur flex items-center justify-center hover:bg-background"
              aria-label="Previous photo"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {safeIdx < photos.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIdx(safeIdx + 1);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/70 backdrop-blur flex items-center justify-center hover:bg-background"
              aria-label="Next photo"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {photos.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  i === safeIdx ? "bg-white" : "bg-white/40",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function FeedCard({ record }: { record: AppRecord }) {
  const { user: viewer } = useAuth();
  const [optimistic, setOptimistic] = useState<{
    liked: boolean;
    count: number;
  } | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const liked = optimistic?.liked ?? record.likedByMe;
  const likeCount = optimistic?.count ?? record.likeCount;
  const isUnknown = !record.speciesName;
  const photos = record.photos && record.photos.length > 0
    ? record.photos
    : record.photoDataUrl
      ? [record.photoDataUrl]
      : [];

  // Lazy-load comments when section opens
  const commentsQ = useQuery({
    queryKey: ["/api/records", record.id, "comments"],
    queryFn: () => apiListComments(record.id).then((r) => r.comments),
    enabled: showComments,
  });

  const likeMut = useMutation({
    mutationFn: async () => {
      const willLike = !liked;
      setOptimistic({
        liked: willLike,
        count: likeCount + (willLike ? 1 : -1),
      });
      return willLike
        ? apiLikeRecord(record.id)
        : apiUnlikeRecord(record.id);
    },
    onSuccess: (res) => {
      setOptimistic({ liked: res.liked, count: res.likeCount });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
    },
    onError: () => {
      setOptimistic({ liked: record.likedByMe, count: record.likeCount });
    },
  });

  const handleLike = () => {
    if (!viewer || likeMut.isPending) return;
    likeMut.mutate();
  };

  const handleDoubleTap = () => {
    if (!viewer) return;
    if (!liked) likeMut.mutate();
    setShowHeart(true);
    window.setTimeout(() => setShowHeart(false), 800);
  };

  const invalidateKeys: any[][] = [
    ["/api/records", record.id, "comments"],
    ["/api/feed"],
    ["/api/records"],
  ];

  const comments: AppComment[] = commentsQ.data ?? [];

  return (
    <article
      className="rounded-lg overflow-hidden bg-card border border-border"
      data-testid={`feedcard-${record.id}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {record.author ? (
            <Link
              href={`/u/${record.author.username}`}
              className="flex items-center gap-2.5 min-w-0"
              data-testid={`link-author-${record.id}`}
            >
              <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                {record.author.avatarDataUrl && (
                  <img
                    src={record.author.avatarDataUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition:
                        (record.author as any).avatarPos || "50% 50%",
                    }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{record.author.displayName || record.author.username}</span>
                  <AdminBadge user={record.author} variant="compact" />
                </div>
                {record.placeGuess && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{record.placeGuess}</span>
                  </div>
                )}
              </div>
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">Unknown</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isUnknown && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <HelpCircle className="h-3 w-3" /> Needs ID
            </span>
          )}
          {record.obscured && (
            <span
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              title="Location obscured"
            >
              <Lock className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>

      {/* Photo */}
      <Link
        href={`/r/${record.id}`}
        className="block relative group"
        data-testid={`link-record-${record.id}`}
        onClick={(e) => {
          // allow double-tap-to-like to fire without nav on the photo area
          if (e.detail === 2) e.preventDefault();
        }}
      >
        <FeedPhotoCarousel
          photos={photos}
          alt={record.speciesName || "Unknown species"}
          onDoubleClick={handleDoubleTap}
        />
        {photos.length > 1 && (
          <div className="absolute top-3 right-3 px-2 py-0.5 rounded text-[11px] bg-background/80 backdrop-blur flex items-center gap-1 pointer-events-none">
            <Images className="h-3 w-3" />
            {photos.length}
          </div>
        )}
        {showHeart && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Heart
              className="h-24 w-24 fill-red-500 text-red-500 drop-shadow-lg animate-in zoom-in fade-in duration-300"
            />
          </div>
        )}
      </Link>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-2 sm:px-3 pt-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLike}
          disabled={!viewer || likeMut.isPending}
          aria-pressed={liked}
          data-testid={`button-like-${record.id}`}
          className="h-9 w-9"
        >
          <Heart
            className={cn(
              "h-6 w-6 transition-transform",
              liked && "fill-red-500 text-red-500 scale-110",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowComments((v) => !v)}
          data-testid={`button-toggle-comments-${record.id}`}
          className="h-9 w-9"
          aria-label="Toggle comments"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
        {viewer && viewer.id !== record.author?.id && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSuggestOpen(true)}
            data-testid={`button-suggest-id-${record.id}`}
            className="h-9 w-9"
            aria-label="Suggest an ID"
            title="Suggest an ID"
          >
            <Sparkles className="h-6 w-6" />
          </Button>
        )}
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
      </div>

      {/* Like + caption + comment count */}
      <div className="px-3 sm:px-4 pb-2 space-y-1">
        {likeCount > 0 && (
          <div
            className="text-sm font-semibold"
            data-testid={`text-like-count-${record.id}`}
          >
            {likeCount} {likeCount === 1 ? "like" : "likes"}
          </div>
        )}

        <div className="text-sm">
          {record.author && (
            <Link
              href={`/u/${record.author.username}`}
              className="font-semibold mr-1.5 hover:underline inline-flex items-center gap-1"
            >
              {record.author.displayName || record.author.username}
              <AdminBadge user={record.author} variant="compact" />
            </Link>
          )}
          {isUnknown ? (
            <span className="text-muted-foreground">posted a record needing ID</span>
          ) : (
            <Link
              href={record.speciesId ? `/species/${record.speciesId}` : `/r/${record.id}`}
              className="hover:underline"
              data-testid={`link-species-${record.id}`}
            >
              <span className="font-medium">
                {record.speciesCommon || record.speciesName}
              </span>
              {record.speciesCommon && (
                <span className="italic text-muted-foreground">
                  {" "}
                  · {record.speciesName}
                </span>
              )}
            </Link>
          )}
        </div>

        {record.notes && (
          <p
            className="text-sm whitespace-pre-wrap line-clamp-3"
            data-testid={`text-notes-${record.id}`}
          >
            {record.notes}
          </p>
        )}

        {(record.commentCount > 0 || showComments) && (
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="text-[12px] text-muted-foreground hover:text-foreground"
            data-testid={`button-view-comments-${record.id}`}
          >
            {showComments
              ? "Hide comments"
              : record.commentCount === 1
                ? "View 1 comment"
                : `View all ${record.commentCount} comments`}
          </button>
        )}

        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {formatDate(
            record.observedOn
              ? new Date(record.observedOn).getTime()
              : record.createdAt,
          )}
        </div>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="border-t border-border px-3 sm:px-4 py-3">
          {commentsQ.isLoading ? (
            <div className="text-xs text-muted-foreground">
              Loading comments…
            </div>
          ) : (
            <CommentsThread
              recordId={record.id}
              comments={comments}
              isOwner={viewer?.id === record.author?.id}
              invalidateKeys={invalidateKeys}
              compact
              header={false}
            />
          )}
        </div>
      )}
    </article>
  );
}

export default FeedCard;
