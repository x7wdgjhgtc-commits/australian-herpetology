import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SpeciesPicker, type PickedSpecies } from "@/components/SpeciesPicker";
import { apiSuggestId } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

/**
 * Reusable Suggest-ID dialog. Used by FeedCard (under the heart/comment row)
 * and by Record.tsx for a quick top-of-page CTA. Invalidates the supplied
 * query keys on success so suggestions / counts refresh automatically.
 */
export function SuggestIdDialog({
  recordId,
  open,
  onOpenChange,
  invalidateKeys,
  trigger,
  title,
}: {
  recordId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Query keys to invalidate after a successful suggestion. */
  invalidateKeys?: Array<readonly unknown[]>;
  /** Optional trigger element rendered as a DialogTrigger child. */
  trigger?: React.ReactNode;
  title?: string;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<PickedSpecies | null>(null);
  const [comment, setComment] = useState("");

  const reset = () => {
    setPicked(null);
    setComment("");
  };

  const suggestM = useMutation({
    mutationFn: async () => {
      if (!picked || !picked.scientificName) {
        throw new Error("Pick a species first");
      }
      return apiSuggestId(recordId, {
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
      const keys = invalidateKeys ?? [
        ["/api/records", recordId],
        ["/api/records"],
        ["/api/feed"],
      ];
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: key as any });
      }
      toast({ title: "Suggestion posted" });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Could not post suggestion",
        description: err?.message || "",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      {trigger}
      <DialogContent
        className="max-w-lg"
        data-testid="dialog-suggest-id"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {title ?? "Suggest an ID"}
          </DialogTitle>
          <DialogDescription>
            Help identify this record. Pick the species you think it is and add
            an optional note.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <SpeciesPicker
            value={picked}
            onChange={setPicked}
            allowUnknown={false}
          />
          <div>
            <Label htmlFor={`suggest-comment-${recordId}`}>
              Comment (optional)
            </Label>
            <Textarea
              id={`suggest-comment-${recordId}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Why you think it's this species…"
              data-testid="input-suggest-dialog-comment"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-suggest-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => suggestM.mutate()}
            disabled={!picked || suggestM.isPending}
            data-testid="button-suggest-dialog-submit"
          >
            {suggestM.isPending ? "Posting…" : "Post suggestion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
