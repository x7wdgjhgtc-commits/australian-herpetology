import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { popPreviousInternal } from "@/lib/navHistory";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiCreateNote, fetchTaxon } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SpeciesPicker, type PickedSpecies } from "@/components/SpeciesPicker";
import { queryClient } from "@/lib/queryClient";

export default function NewNote() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [picked, setPicked] = useState<PickedSpecies | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prefilling, setPrefilling] = useState(false);

  useEffect(() => {
    if (!user) setLocation("/login");
  }, [user, setLocation]);

  // Pre-fill species from ?speciesId= query param (path router)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("speciesId");
    if (!sid) return;
    const id = parseInt(sid, 10);
    if (!Number.isFinite(id)) return;
    setPrefilling(true);
    fetchTaxon(id)
      .then((res) => {
        const tax = res.results?.[0];
        if (!tax) return;
        setPicked({
          taxonId: tax.id,
          scientificName: tax.name,
          commonName: tax.preferred_common_name ?? null,
          groupKey: null,
          familyId: null,
          familyName: null,
          genus: tax.name?.split(/\s+/)[0] ?? null,
          parentSpeciesId: null,
          rank: "species",
        });
      })
      .catch(() => {})
      .finally(() => setPrefilling(false));
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      if (!picked || !picked.taxonId) {
        throw new Error("Pick a species to attach this note to");
      }
      const text = body.trim();
      if (text.length < 4) {
        throw new Error("Add a few sentences describing your observation");
      }
      return apiCreateNote({
        speciesId: picked.taxonId,
        parentSpeciesId: picked.parentSpeciesId ?? null,
        speciesName: picked.scientificName,
        speciesCommon: picked.commonName,
        groupKey: picked.groupKey ?? null,
        familyId: picked.familyId ?? null,
        familyName: picked.familyName ?? null,
        genus: picked.genus ?? null,
        title: title.trim() || null,
        body: text,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/feed"] });
      toast({
        title: "Observation note published",
        description: "Your note is now visible in the feed.",
      });
      setLocation(`/n/${res.note.id}`);
    },
    onError: (err: any) => {
      toast({
        title: "Could not publish note",
        description: err?.message || "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <header className="mb-6">
        <h1
          className="font-serif text-2xl font-semibold flex items-center gap-2"
          data-testid="text-new-note-title"
        >
          <BookOpen className="h-5 w-5" />
          New observation note
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Share a scientific observation, behavioural note, or field
          documentation. Notes appear in the feed and on the species page.
        </p>
      </header>

      <div className="space-y-5">
        {/* Species picker */}
        <div className="space-y-2">
          <Label>Species</Label>
          {prefilling ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading species…
            </div>
          ) : (
            <SpeciesPicker
              value={picked}
              onChange={setPicked}
              allowUnknown={false}
            />
          )}
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="note-title">Title (optional)</Label>
          <Input
            id="note-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Defensive display in juvenile Eastern Brown"
            maxLength={200}
            data-testid="input-note-title"
          />
        </div>

        {/* Body */}
        <div className="space-y-2">
          <Label htmlFor="note-body">Observation</Label>
          <Textarea
            id="note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the behaviour, microhabitat, interaction, or scientific observation in detail…"
            rows={10}
            className="min-h-[220px] font-serif text-base leading-relaxed"
            data-testid="textarea-note-body"
          />
          <p className="text-xs text-muted-foreground">
            {body.trim().length} characters
          </p>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-2 justify-end pt-2">
          <Button
            variant="outline"
            onClick={() => setLocation(popPreviousInternal() ?? "/feed")}
            data-testid="button-cancel-note"
          >
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !picked || body.trim().length < 4}
            data-testid="button-publish-note"
          >
            {create.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publishing…
              </>
            ) : (
              "Publish note"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
