import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Heart, MessageCircle, BookOpen } from "lucide-react";
import {
  apiLikeNote,
  apiUnlikeNote,
  apiListNoteComments,
  type AppNote,
  type AppNoteComment,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { NoteCommentsThread } from "@/components/NoteCommentsThread";
import { AdminBadge } from "@/components/AdminBadge";
import { cn } from "@/lib/utils";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function NoteCard({ note }: { note: AppNote }) {
  const { user: viewer } = useAuth();
  const [optimistic, setOptimistic] = useState<{
    liked: boolean;
    count: number;
  } | null>(null);
  const [showComments, setShowComments] = useState(false);

  const liked = optimistic?.liked ?? note.likedByMe;
  const likeCount = optimistic?.count ?? note.likeCount;

  const commentsQ = useQuery({
    queryKey: ["/api/notes", note.id, "comments"],
    queryFn: () => apiListNoteComments(note.id).then((r) => r.comments),
    enabled: showComments,
  });

  const likeMut = useMutation({
    mutationFn: async () => {
      const willLike = !liked;
      setOptimistic({
        liked: willLike,
        count: likeCount + (willLike ? 1 : -1),
      });
      return willLike ? apiLikeNote(note.id) : apiUnlikeNote(note.id);
    },
    onSuccess: (res) => {
      setOptimistic({ liked: res.liked, count: res.likeCount });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/feed"] });
    },
    onError: () => {
      setOptimistic({ liked: note.likedByMe, count: note.likeCount });
    },
  });

  const handleLike = () => {
    if (!viewer || likeMut.isPending) return;
    likeMut.mutate();
  };

  const invalidateKeys: any[][] = [
    ["/api/notes", note.id, "comments"],
    ["/api/notes", note.id],
    ["/api/notes"],
    ["/api/notes/feed"],
  ];

  const comments: AppNoteComment[] = commentsQ.data ?? [];

  return (
    <article
      className="rounded-lg bg-card border border-border overflow-hidden"
      data-testid={`notecard-${note.id}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {note.author ? (
            <Link
              href={`/u/${note.author.username}`}
              className="flex items-center gap-2.5 min-w-0"
              data-testid={`link-note-author-${note.id}`}
            >
              <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                {note.author.avatarDataUrl && (
                  <img
                    src={note.author.avatarDataUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition:
                        (note.author as any).avatarPos || "50% 50%",
                    }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{note.author.displayName || note.author.username}</span>
                  <AdminBadge user={note.author} variant="compact" />
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3 w-3 shrink-0" />
                  Observation note
                </div>
              </div>
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">Unknown</span>
          )}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">
          {formatDate(note.createdAt)}
        </div>
      </div>

      {/* Body */}
      <Link
        href={`/n/${note.id}`}
        className="block px-3 sm:px-4 pb-3"
        data-testid={`link-note-${note.id}`}
      >
        {note.title && (
          <h3
            className="font-serif text-lg font-semibold leading-snug mb-1.5"
            data-testid={`text-note-title-${note.id}`}
          >
            {note.title}
          </h3>
        )}
        {note.speciesId && (
          <div className="text-xs text-muted-foreground mb-2">
            on{" "}
            <span className="font-medium text-foreground">
              {note.speciesCommon || note.speciesName}
            </span>
            {note.speciesCommon && note.speciesName && (
              <span className="italic"> · {note.speciesName}</span>
            )}
          </div>
        )}
        <p
          className="text-sm whitespace-pre-wrap line-clamp-6 leading-relaxed"
          data-testid={`text-note-body-${note.id}`}
        >
          {note.body}
        </p>
      </Link>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-2 sm:px-3 pb-2 border-t border-border pt-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLike}
          disabled={!viewer || likeMut.isPending}
          aria-pressed={liked}
          data-testid={`button-like-note-${note.id}`}
          className="h-9 w-9"
        >
          <Heart
            className={cn(
              "h-5 w-5 transition-transform",
              liked && "fill-red-500 text-red-500 scale-110",
            )}
          />
        </Button>
        {likeCount > 0 && (
          <span
            className="text-sm font-medium"
            data-testid={`text-note-like-count-${note.id}`}
          >
            {likeCount}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowComments((v) => !v)}
          data-testid={`button-toggle-note-comments-${note.id}`}
          className="h-9 w-9 ml-1"
          aria-label="Toggle comments"
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
        {(note.commentCount > 0 || showComments) && (
          <span className="text-sm font-medium">
            {note.commentCount > 0 ? note.commentCount : ""}
          </span>
        )}
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="border-t border-border px-3 sm:px-4 py-3">
          {commentsQ.isLoading ? (
            <div className="text-xs text-muted-foreground">
              Loading comments…
            </div>
          ) : (
            <NoteCommentsThread
              noteId={note.id}
              comments={comments}
              isOwner={viewer?.id === note.author?.id}
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

export default NoteCard;
