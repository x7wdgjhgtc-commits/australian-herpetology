import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  Trash2,
  Pencil,
  Loader2,
  BookOpen,
  Save,
  X,
} from "lucide-react";
import {
  apiGetNote,
  apiLikeNote,
  apiUnlikeNote,
  apiListNoteComments,
  apiUpdateNote,
  apiDeleteNote,
  type AppNoteComment,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { BackButton } from "@/components/BackButton";
import { NoteCommentsThread } from "@/components/NoteCommentsThread";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Note() {
  const [, params] = useRoute("/n/:id");
  const id = parseInt(params?.id || "", 10);
  const { user: viewer } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [optimistic, setOptimistic] = useState<{
    liked: boolean;
    count: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const noteQ = useQuery({
    queryKey: ["/api/notes", id],
    queryFn: () => apiGetNote(id).then((r) => r.note),
    enabled: Number.isFinite(id),
  });

  const commentsQ = useQuery({
    queryKey: ["/api/notes", id, "comments"],
    queryFn: () => apiListNoteComments(id).then((r) => r.comments),
    enabled: Number.isFinite(id),
  });

  const note = noteQ.data;
  const liked = optimistic?.liked ?? note?.likedByMe ?? false;
  const likeCount = optimistic?.count ?? note?.likeCount ?? 0;
  const isOwner = !!viewer && !!note?.author && viewer.id === note.author.id;

  const likeMut = useMutation({
    mutationFn: async () => {
      if (!note) return;
      const willLike = !liked;
      setOptimistic({
        liked: willLike,
        count: likeCount + (willLike ? 1 : -1),
      });
      return willLike ? apiLikeNote(note.id) : apiUnlikeNote(note.id);
    },
    onSuccess: (res) => {
      if (!res) return;
      setOptimistic({ liked: res.liked, count: res.likeCount });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/feed"] });
    },
    onError: () => {
      if (note) {
        setOptimistic({ liked: note.likedByMe, count: note.likeCount });
      }
    },
  });

  const editMut = useMutation({
    mutationFn: () =>
      apiUpdateNote(id, {
        title: editTitle.trim() || null,
        body: editBody.trim(),
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/notes", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/feed"] });
      toast({ title: "Note updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not save",
        description: err?.message || "",
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => apiDeleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/feed"] });
      toast({ title: "Note deleted" });
      setLocation("/feed");
    },
    onError: (err: any) => {
      toast({
        title: "Could not delete",
        description: err?.message || "",
        variant: "destructive",
      });
    },
  });

  const startEdit = () => {
    if (!note) return;
    setEditTitle(note.title ?? "");
    setEditBody(note.body);
    setEditing(true);
  };

  if (!Number.isFinite(id)) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <p className="text-sm text-muted-foreground">Invalid note id.</p>
      </div>
    );
  }

  if (noteQ.isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (noteQ.isError || !note) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="font-serif text-xl font-semibold mb-2">
          Note not found
        </h1>
        <p className="text-sm text-muted-foreground">
          This observation note may have been removed.
        </p>
        <div className="mt-4">
          <BackButton fallback="/feed" label="Back" />
        </div>
      </div>
    );
  }

  const invalidateKeys: any[][] = [
    ["/api/notes", id, "comments"],
    ["/api/notes", id],
    ["/api/notes"],
    ["/api/notes/feed"],
  ];

  const comments: AppNoteComment[] = commentsQ.data ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-4 gap-3">
        <BackButton fallback="/feed" label="Back" />
        {isOwner && !editing && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={startEdit}
              data-testid="button-edit-note"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              data-testid="button-delete-note"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Header */}
      <header className="flex items-center gap-3 mb-5">
        {note.author ? (
          <Link
            href={`/u/${note.author.username}`}
            className="flex items-center gap-3 min-w-0"
          >
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 border border-border">
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
            <div>
              <div className="text-sm font-medium">
                {note.author.displayName || note.author.username}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <BookOpen className="h-3 w-3" />
                Observation note · {formatDate(note.createdAt)}
              </div>
            </div>
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Unknown</span>
        )}
      </header>

      {/* Edit form / display */}
      {editing ? (
        <div className="space-y-4 mb-6 border border-border rounded-lg bg-card p-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Title
            </label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={200}
              data-testid="input-edit-note-title"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Observation
            </label>
            <Textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={10}
              className="min-h-[200px] font-serif text-base leading-relaxed"
              data-testid="textarea-edit-note-body"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
              data-testid="button-cancel-edit-note"
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => editMut.mutate()}
              disabled={editMut.isPending || editBody.trim().length < 4}
              data-testid="button-save-edit-note"
            >
              {editMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          {note.title && (
            <h1
              className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight leading-tight mb-3"
              data-testid="text-note-title"
            >
              {note.title}
            </h1>
          )}
          {note.speciesId && (
            <div className="mb-5">
              <Link
                href={`/species/${note.parentSpeciesId ?? note.speciesId}`}
                className="inline-flex items-center gap-2 text-sm border border-border rounded-md px-3 py-1.5 bg-card hover-elevate"
                data-testid="link-note-species"
              >
                <span className="text-muted-foreground">on</span>
                <span className="font-medium">
                  {note.speciesCommon || note.speciesName}
                </span>
                {note.speciesCommon && note.speciesName && (
                  <span className="italic text-muted-foreground">
                    · {note.speciesName}
                  </span>
                )}
              </Link>
            </div>
          )}
          <div
            className="font-serif text-lg leading-relaxed whitespace-pre-wrap text-foreground/90"
            data-testid="text-note-body"
          >
            {note.body}
          </div>
        </>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-1 mt-6 pt-4 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => likeMut.mutate()}
          disabled={!viewer || likeMut.isPending}
          aria-pressed={liked}
          data-testid="button-like-note-detail"
        >
          <Heart
            className={cn(
              "h-5 w-5 mr-2 transition-transform",
              liked && "fill-red-500 text-red-500 scale-110",
            )}
          />
          {likeCount} {likeCount === 1 ? "like" : "likes"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="button-show-note-comments"
        >
          <MessageCircle className="h-5 w-5 mr-2" />
          {note.commentCount} {note.commentCount === 1 ? "comment" : "comments"}
        </Button>
      </div>

      {/* Comments */}
      <section className="mt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Comments
        </h2>
        {commentsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">
            Loading comments…
          </div>
        ) : (
          <NoteCommentsThread
            noteId={note.id}
            comments={comments}
            isOwner={isOwner}
            invalidateKeys={invalidateKeys}
            header={false}
          />
        )}
      </section>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this observation note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the note and all of its comments.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-note">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMut.mutate()}
              data-testid="button-confirm-delete-note"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
