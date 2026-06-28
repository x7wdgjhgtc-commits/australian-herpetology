import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Heart, MessageCircle, Send, Trash2 } from "lucide-react";
import {
  apiAddNoteComment,
  apiDeleteNoteComment,
  apiLikeNoteComment,
  apiUnlikeNoteComment,
  type AppNoteComment,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AdminBadge } from "@/components/AdminBadge";

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Hierarchical = AppNoteComment & { replies: AppNoteComment[] };

function buildTree(comments: AppNoteComment[]): Hierarchical[] {
  const tops: Hierarchical[] = [];
  const byId = new Map<number, Hierarchical>();
  for (const c of comments) {
    if (c.parentId == null) {
      const h: Hierarchical = { ...c, replies: [] };
      tops.push(h);
      byId.set(c.id, h);
    }
  }
  for (const c of comments) {
    if (c.parentId != null) {
      const parent = byId.get(c.parentId);
      if (parent) parent.replies.push(c);
      else tops.push({ ...c, replies: [] });
    }
  }
  return tops;
}

function CommentItem({
  comment,
  noteId,
  isReply = false,
  isOwner,
  canModerate,
  onReply,
  invalidateKeys,
}: {
  comment: AppNoteComment;
  noteId: number;
  isReply?: boolean;
  isOwner: boolean;
  canModerate: boolean;
  onReply: (commentId: number, username: string) => void;
  invalidateKeys: any[][];
}) {
  const { user: viewer } = useAuth();
  const { toast } = useToast();
  const isAuthor = viewer?.id === comment.user?.id;
  const canDelete = isAuthor || isOwner || canModerate;

  const likeM = useMutation({
    mutationFn: () =>
      comment.likedByMe
        ? apiUnlikeNoteComment(comment.id)
        : apiLikeNoteComment(comment.id),
    onSuccess: () => {
      invalidateKeys.forEach((qk) =>
        queryClient.invalidateQueries({ queryKey: qk }),
      );
    },
    onError: (err: any) => {
      toast({
        title: "Could not update like",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const delM = useMutation({
    mutationFn: () => apiDeleteNoteComment(noteId, comment.id),
    onSuccess: () => {
      invalidateKeys.forEach((qk) =>
        queryClient.invalidateQueries({ queryKey: qk }),
      );
    },
  });

  return (
    <li
      className={cn(
        "flex items-start gap-2.5",
        isReply ? "pl-6 sm:pl-9" : "",
      )}
      data-testid={`note-comment-${comment.id}`}
    >
      <Link
        href={comment.user ? `/u/${comment.user.username}` : "#"}
        className={cn(
          "rounded-full bg-muted overflow-hidden shrink-0",
          isReply ? "w-6 h-6" : "w-8 h-8",
        )}
      >
        {comment.user?.avatarDataUrl ? (
          <img
            src={comment.user.avatarDataUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{
              objectPosition: (comment.user as any).avatarPos || "50% 50%",
            }}
          />
        ) : null}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-muted/60 px-3 py-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              href={comment.user ? `/u/${comment.user.username}` : "#"}
              className="font-medium text-xs sm:text-sm hover:underline inline-flex items-center gap-1"
              data-testid={`link-note-commenter-${comment.id}`}
            >
              {comment.user?.displayName || comment.user?.username || "Unknown"}
              <AdminBadge user={comment.user} variant="compact" />
            </Link>
          </div>
          <p
            className="text-sm mt-0.5 whitespace-pre-wrap break-words"
            data-testid={`text-note-comment-body-${comment.id}`}
          >
            {comment.body}
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 ml-1 text-[11px] text-muted-foreground">
          <span>{formatTimestamp(comment.createdAt)}</span>
          {viewer && (
            <button
              type="button"
              onClick={() => likeM.mutate()}
              disabled={likeM.isPending}
              className={cn(
                "font-medium hover:text-foreground",
                comment.likedByMe && "text-red-500 hover:text-red-600",
              )}
              data-testid={`button-like-note-comment-${comment.id}`}
            >
              {comment.likedByMe ? "Liked" : "Like"}
            </button>
          )}
          {comment.likeCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Heart className="h-3 w-3 fill-red-500 text-red-500" />
              {comment.likeCount}
            </span>
          )}
          {viewer && !isReply && (
            <button
              type="button"
              onClick={() => onReply(comment.id, comment.user?.username ?? "")}
              className="font-medium hover:text-foreground"
              data-testid={`button-reply-note-comment-${comment.id}`}
            >
              Reply
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => delM.mutate()}
              className="ml-auto hover:text-destructive"
              data-testid={`button-delete-note-comment-${comment.id}`}
              aria-label="Delete comment"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function NoteCommentsThread({
  noteId,
  comments,
  isOwner,
  canModerate = false,
  invalidateKeys,
  compact = false,
  header = true,
}: {
  noteId: number;
  comments: AppNoteComment[];
  isOwner: boolean;
  canModerate?: boolean;
  invalidateKeys: any[][];
  compact?: boolean;
  header?: boolean;
}) {
  const { user: viewer } = useAuth();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [replyParent, setReplyParent] = useState<{
    id: number;
    username: string;
  } | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const tree = useMemo(() => buildTree(comments), [comments]);
  const totalCount = comments.length;

  const addM = useMutation({
    mutationFn: () => apiAddNoteComment(noteId, body.trim()),
    onSuccess: () => {
      setBody("");
      invalidateKeys.forEach((qk) =>
        queryClient.invalidateQueries({ queryKey: qk }),
      );
    },
    onError: (err: any) => {
      toast({
        title: "Could not post comment",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const replyM = useMutation({
    mutationFn: () => {
      if (!replyParent) throw new Error("No parent");
      return apiAddNoteComment(noteId, replyBody.trim(), replyParent.id);
    },
    onSuccess: () => {
      setReplyBody("");
      setReplyParent(null);
      invalidateKeys.forEach((qk) =>
        queryClient.invalidateQueries({ queryKey: qk }),
      );
    },
    onError: (err: any) => {
      toast({
        title: "Could not post reply",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const handleReply = (commentId: number, username: string) => {
    setReplyParent({ id: commentId, username });
    setReplyBody(username ? `@${username} ` : "");
  };

  return (
    <section
      data-testid="section-note-comments"
      className={compact ? "space-y-2" : "space-y-3"}
    >
      {header && (
        <h2
          className={cn(
            "font-serif font-semibold flex items-center gap-2",
            compact ? "text-sm" : "text-lg",
          )}
        >
          <MessageCircle className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          Comments
          {totalCount > 0 && (
            <span className="text-muted-foreground font-normal">
              ({totalCount})
            </span>
          )}
        </h2>
      )}

      {totalCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet. Start the conversation.
        </p>
      ) : (
        <ul className={compact ? "space-y-2.5" : "space-y-3"}>
          {tree.map((top) => (
            <li key={top.id} className="space-y-2">
              <CommentItem
                comment={top}
                noteId={noteId}
                isOwner={isOwner}
                canModerate={canModerate}
                onReply={handleReply}
                invalidateKeys={invalidateKeys}
              />
              {top.replies.length > 0 && (
                <ul className="space-y-2.5">
                  {top.replies.map((r) => (
                    <CommentItem
                      key={r.id}
                      comment={r}
                      noteId={noteId}
                      isReply
                      isOwner={isOwner}
                      canModerate={canModerate}
                      onReply={handleReply}
                      invalidateKeys={invalidateKeys}
                    />
                  ))}
                </ul>
              )}
              {replyParent?.id === top.id && viewer && (
                <div className="pl-6 sm:pl-9 flex gap-2 items-start">
                  <Textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={`Reply to ${top.user?.displayName || top.user?.username || "comment"}…`}
                    rows={2}
                    className="flex-1 text-sm"
                    data-testid={`input-note-reply-${top.id}`}
                    autoFocus
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (replyBody.trim()) replyM.mutate();
                      }}
                      disabled={!replyBody.trim() || replyM.isPending}
                      data-testid={`button-submit-note-reply-${top.id}`}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReplyParent(null);
                        setReplyBody("");
                      }}
                      data-testid={`button-cancel-note-reply-${top.id}`}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {viewer ? (
        <div className="flex gap-2 items-end pt-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…"
            rows={compact ? 1 : 2}
            className="flex-1 text-sm"
            data-testid="input-new-note-comment"
          />
          <Button
            onClick={() => {
              if (body.trim()) addM.mutate();
            }}
            disabled={!body.trim() || addM.isPending}
            data-testid="button-post-note-comment"
            size={compact ? "sm" : "default"}
          >
            <Send className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Post</span>
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground text-center">
          <Link href="/login" className="text-primary underline">
            Log in
          </Link>{" "}
          to comment.
        </div>
      )}
    </section>
  );
}

export default NoteCommentsThread;
