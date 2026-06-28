import { useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMySpecies } from "@/lib/mySpecies";
import { SeenBadge } from "@/components/SeenBadge";
import { UnseenBadge } from "@/components/UnseenBadge";
import {
  fetchTaxon,
  fetchObservations,
  fetchDistribution,
  fetchAuthority,
  fetchMorphology,
  classifyHerp,
  biggerPhoto,
  cleanSummary,
  licenseInfo,
  apiGetSpeciesStats,
  apiGetSpeciesTopPhoto,
  apiGetSpeciesOverrides,
  apiPatchSpeciesOverride,
  apiHideSpeciesPhoto,
  apiUnhideSpeciesPhoto,
  apiForceHeroPhoto,
  apiRecordsForSpecies,
  apiNotesForSpecies,
  apiGetSubspeciesCatalog,
  apiListSpeciesArticles,
  apiCreateSpeciesArticle,
  apiDeleteSpeciesArticle,
  type SpeciesArticleRow,
  type TaxonDetailResponse,
  type ObservationsResponse,
  type DistributionResponse,
  type AuthorityResponse,
  type MorphologyResponse,
  type SpeciesStatsResponse,
  type SpeciesTopPhoto,
  type SpeciesOverride,
  type AppRecord,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trophy, CheckCircle2, Heart, Pin, Pencil, EyeOff, Eye, FileText, Upload, Download, Plus, Trash2, Link as LinkIcon, BadgeCheck, Star, X as XIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ExternalLink, MapPin, Calendar, ImageOff, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NoteCard } from "@/components/NoteCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DistributionMap from "@/components/DistributionMap";
import GridDistributionMap from "@/components/GridDistributionMap";
import { BackButton } from "@/components/BackButton";

/**
 * Try to derive the species authority (describer + year) from
 * iNaturalist data. iNat doesn't expose this as a structured field but
 * the wikipedia summary almost always contains it in parentheses.
 */
function extractAuthority(name: string, summary: string | null | undefined) {
  if (!summary) return null;
  // Common patterns: "(Gray, 1841)" or "Linnaeus, 1758"
  const m = summary.match(/\(([A-Z][A-Za-z' .\-]+,?\s*\d{4})\)/) ||
    summary.match(/\b([A-Z][A-Za-z' .\-]+,\s*\d{4})\b/);
  return m ? m[1] : null;
}

/** Pull habitat / diet / size hints out of free-text summary. */
function extractFacts(summary: string) {
  // Split into sentences, skip any sentence that begins mid-parenthetical
  // (a sign the previous sentence boundary was inside formatting we stripped).
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && !/^[\)\(,;]/.test(s) && !/^[a-z]/.test(s));

  const findSentence = (regex: RegExp) =>
    sentences.find((s) => regex.test(s)) || null;

  const clean = (s: string | null) => {
    if (!s) return null;
    // Strip leading orphan parentheticals from removed wiki templates.
    return s.replace(/^\([^)]*\)\s*/, "").trim();
  };

  const habitat = clean(
    findSentence(
      /\b(habitat|habitats|inhabits?|found in|lives in|occurs in|native to|endemic to|forests?|woodlands?|grasslands?|wetlands?|coastal|arid|tropical|temperate)\b/i,
    ),
  );
  const diet = clean(
    findSentence(
      /\b(diet|prey|feeds on|eats|carnivor|insectivor|herbivor|piscivor|omnivor|hunts?)\b/i,
    ),
  );
  const size = clean(
    findSentence(
      /\b(\d+\s*(cm|mm|m|metres?|inches?)\b|snout[- ]vent|total length|reaching|grows to|reach(es)? up to)\b/i,
    ),
  );
  return { habitat, diet, size };
}

export default function Species() {
  const { id } = useParams<{ id: string }>();

  const { data: taxonData, isLoading: loadingTaxon } = useQuery<TaxonDetailResponse>({
    queryKey: ["/api/taxon", id],
    queryFn: () => fetchTaxon(id!),
    enabled: !!id,
  });

  const { data: obsData, isLoading: loadingObs } = useQuery<ObservationsResponse>({
    queryKey: ["/api/observations", id],
    queryFn: () => fetchObservations(id!, 12),
    enabled: !!id,
  });

  const { data: distData, isLoading: loadingDist } = useQuery<DistributionResponse>({
    queryKey: ["/api/distribution", id],
    queryFn: () => fetchDistribution(id!),
    enabled: !!id,
  });

  const taxon = taxonData?.results?.[0];

  // Has the viewer recorded this species? Used to render the green tick.
  const mySpecies = useMySpecies();
  const mySpeciesCount = taxon ? (mySpecies.countsBySpecies.get(taxon.id) ?? 0) : 0;

  const { data: authorityData } = useQuery<AuthorityResponse>({
    queryKey: ["/api/authority", taxon?.name],
    queryFn: () => fetchAuthority(taxon!.name),
    enabled: !!taxon?.name,
  });
  const summary = useMemo(() => cleanSummary(taxon?.wikipedia_summary), [taxon]);
  const facts = useMemo(() => extractFacts(summary), [summary]);
  // Priority order for the displayed taxonomic authority:
  //   1. `taxon.authority`     — server-merged: admin override > ALA namematching
  //                              (already runs inside /api/taxon/:id, so it
  //                              loads with the main fetch with no extra
  //                              client round-trip)
  //   2. `authorityData.author`— secondary ALA call from /api/authority
  //                              (kept for resilience + classification fields)
  //   3. regex fallback        — extract "(Author, Year)" from the Wikipedia
  //                              summary when ALA has nothing.
  const authority = useMemo(
    () =>
      (taxon as { authority?: string | null } | undefined)?.authority ||
      authorityData?.author ||
      extractAuthority(taxon?.name || "", summary),
    [taxon, authorityData, summary],
  );

  const family =
    taxon?.ancestors?.find((a) => a.rank === "family")?.name ||
    titleCase(authorityData?.family);
  const order =
    taxon?.ancestors?.find((a) => a.rank === "order")?.name ||
    titleCase(authorityData?.order);
  const className =
    taxon?.ancestors?.find((a) => a.rank === "class")?.name ||
    titleCase(authorityData?.class);

  // Classify into snake / lizard / amphibian for the morphology section.
  const morphGroup = useMemo(
    () => classifyHerp(className, order, family),
    [className, order, family],
  );
  const { data: morphData, isLoading: loadingMorph } = useQuery<MorphologyResponse>({
    queryKey: ["/api/morphology", taxon?.name, morphGroup],
    queryFn: () => fetchMorphology(taxon!.name, morphGroup!),
    enabled: !!taxon?.name && !!morphGroup,
  });

  const { user } = useAuth();
  const { toast } = useToast();
  const speciesIdNum = id ? parseInt(id, 10) : null;
  const { data: statsData } = useQuery<SpeciesStatsResponse>({
    queryKey: ["/api/species", speciesIdNum, "stats", !!user],
    queryFn: () => apiGetSpeciesStats(speciesIdNum!),
    enabled: speciesIdNum != null,
  });

  // Top-liked (or pinned) user-submitted photo for this species.
  const { data: topPhotoData } = useQuery<SpeciesTopPhoto>({
    queryKey: ["/api/species", speciesIdNum, "top-photo"],
    queryFn: () => apiGetSpeciesTopPhoto(speciesIdNum!),
    enabled: speciesIdNum != null,
  });

  // Admin/editor overrides: notes, common name, hidden iNat photos, pinned hero.
  const { data: overridesData } = useQuery<{ override: SpeciesOverride }>({
    queryKey: ["/api/species", speciesIdNum, "overrides"],
    queryFn: () => apiGetSpeciesOverrides(speciesIdNum!),
    enabled: speciesIdNum != null,
  });
  const override = overridesData?.override;

  // Capability gates (server enforces; UI just hides controls).
  // Capabilities are resolved on the server (role defaults overlaid with explicit overrides),
  // so non-editor roles can be granted editSpecies/hidePhotos by a super-admin.
  const isEditorPlus = !!user?.capabilities?.editSpecies;
  const isAdminPlus = !!user?.capabilities?.hidePhotos;

  // Records of this species — fetched for everyone (powers the Records list)
  // and also used by the Edit-species dialog to pick a hero record.
  const { data: speciesRecordsData, isLoading: loadingSpeciesRecords } = useQuery<{
    records: AppRecord[];
  }>({
    queryKey: ["/api/records", "species", speciesIdNum],
    queryFn: () => apiRecordsForSpecies(speciesIdNum as number),
    enabled: speciesIdNum != null,
  });

  // When viewing a species, list its subspecies (children) below the header.
  // When viewing a subspecies, this returns empty and the parent banner is shown instead.
  const isSubspecies = taxon?.rank === "subspecies";
  const parentSpeciesId = isSubspecies
    ? (taxon as any)?.parent_id ??
      ((taxon?.ancestor_ids || []).slice(-2, -1)[0] ?? null)
    : null;
  const { data: subspeciesChildren } = useQuery({
    queryKey: ["/api/subspecies/catalog", speciesIdNum, "children"],
    queryFn: () => apiGetSubspeciesCatalog({ parentId: speciesIdNum! }),
    enabled: speciesIdNum != null && !isSubspecies,
  });
  // Parent species taxon, for the banner shown on subspecies pages.
  const { data: parentTaxonData } = useQuery<TaxonDetailResponse>({
    queryKey: ["/api/taxon", parentSpeciesId],
    queryFn: () => fetchTaxon(parentSpeciesId!),
    enabled: parentSpeciesId != null,
  });
  const parentTaxon = parentTaxonData?.results?.[0];
  const speciesRecords = useMemo(
    () => speciesRecordsData?.records || [],
    [speciesRecordsData],
  );

  // Edit-species dialog state. Every text field is stored as a string; on save
  // a blank string is sent as `null` (which clears the override and falls back
  // to the upstream iNat / ALA value).
  const [editSpeciesOpen, setEditSpeciesOpen] = useState(false);
  const [editCommonName, setEditCommonName] = useState("");
  // Carousel: locally-selected taxon photo (null = use default hero precedence).
  const [selectedPhoto, setSelectedPhoto] = useState<{
    url: string;
    medium_url: string;
    license_code: string | null;
    attribution: string;
  } | null>(null);
  const [editScientific, setEditScientific] = useState("");
  const [editAuthority, setEditAuthority] = useState("");
  const [editClass, setEditClass] = useState("");
  const [editOrder, setEditOrder] = useState("");
  const [editFamily, setEditFamily] = useState("");
  const [editConservation, setEditConservation] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editHabitat, setEditHabitat] = useState("");
  const [editDiet, setEditDiet] = useState("");
  const [editSize, setEditSize] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editHeroId, setEditHeroId] = useState<string>("");
  const [editTotalLength, setEditTotalLength] = useState("");
  const [editSnoutVent, setEditSnoutVent] = useState("");
  const [editBodyLength, setEditBodyLength] = useState("");
  const [editDorsalScales, setEditDorsalScales] = useState("");
  const [editVentralScales, setEditVentralScales] = useState("");
  const [editSubcaudalScales, setEditSubcaudalScales] = useState("");
  const [editAnalScale, setEditAnalScale] = useState("");
  const [editLifecycle, setEditLifecycle] = useState("");
  const [editBehaviour, setEditBehaviour] = useState("");
  const [editVenom, setEditVenom] = useState("");
  const [editRange, setEditRange] = useState("");
  const [editIdentification, setEditIdentification] = useState("");
  const [editSimilarSpecies, setEditSimilarSpecies] = useState("");

  const openEditSpecies = () => {
    setEditCommonName(override?.commonNameOverride ?? "");
    setEditScientific(override?.scientificNameOverride ?? "");
    setEditAuthority(override?.authorityOverride ?? "");
    setEditClass(override?.classOverride ?? "");
    setEditOrder(override?.orderOverride ?? "");
    setEditFamily(override?.familyOverride ?? "");
    setEditConservation(override?.conservationOverride ?? "");
    setEditDescription(override?.descriptionOverride ?? "");
    setEditHabitat(override?.habitatOverride ?? "");
    setEditDiet(override?.dietOverride ?? "");
    setEditSize(override?.sizeOverride ?? "");
    setEditNotes(override?.notesOverride ?? "");
    setEditTotalLength(override?.totalLengthOverride ?? "");
    setEditSnoutVent(override?.snoutVentOverride ?? "");
    setEditBodyLength(override?.bodyLengthOverride ?? "");
    setEditDorsalScales(override?.dorsalScalesOverride ?? "");
    setEditVentralScales(override?.ventralScalesOverride ?? "");
    setEditSubcaudalScales(override?.subcaudalScalesOverride ?? "");
    setEditAnalScale(override?.analScaleOverride ?? "");
    setEditLifecycle(override?.lifecycleOverride ?? "");
    setEditBehaviour(override?.behaviourOverride ?? "");
    setEditVenom(override?.venomOverride ?? "");
    setEditRange(override?.rangeOverride ?? "");
    setEditIdentification(override?.identificationOverride ?? "");
    setEditSimilarSpecies(override?.similarSpeciesOverride ?? "");
    setEditHeroId(
      override?.heroRecordId != null ? String(override.heroRecordId) : "",
    );
    setEditSpeciesOpen(true);
  };

  const patchSpecies = useMutation({
    mutationFn: () =>
      apiPatchSpeciesOverride(speciesIdNum!, {
        commonNameOverride: editCommonName.trim() || null,
        scientificNameOverride: editScientific.trim() || null,
        authorityOverride: editAuthority.trim() || null,
        classOverride: editClass.trim() || null,
        orderOverride: editOrder.trim() || null,
        familyOverride: editFamily.trim() || null,
        conservationOverride: editConservation.trim() || null,
        descriptionOverride: editDescription.trim() || null,
        habitatOverride: editHabitat.trim() || null,
        dietOverride: editDiet.trim() || null,
        sizeOverride: editSize.trim() || null,
        notesOverride: editNotes.trim() || null,
        totalLengthOverride: editTotalLength.trim() || null,
        snoutVentOverride: editSnoutVent.trim() || null,
        bodyLengthOverride: editBodyLength.trim() || null,
        dorsalScalesOverride: editDorsalScales.trim() || null,
        ventralScalesOverride: editVentralScales.trim() || null,
        subcaudalScalesOverride: editSubcaudalScales.trim() || null,
        analScaleOverride: editAnalScale.trim() || null,
        lifecycleOverride: editLifecycle.trim() || null,
        behaviourOverride: editBehaviour.trim() || null,
        venomOverride: editVenom.trim() || null,
        rangeOverride: editRange.trim() || null,
        identificationOverride: editIdentification.trim() || null,
        similarSpeciesOverride: editSimilarSpecies.trim() || null,
        heroRecordId: editHeroId ? parseInt(editHeroId, 10) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesIdNum, "overrides"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesIdNum, "top-photo"],
      });
      toast({ title: "Species updated" });
      setEditSpeciesOpen(false);
    },
    onError: (e: any) => {
      toast({
        title: "Update failed",
        description: e?.message || "Could not update species",
        variant: "destructive",
      });
    },
  });

  const hidePhoto = useMutation({
    mutationFn: (photoUrl: string) =>
      apiHideSpeciesPhoto(speciesIdNum!, photoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesIdNum, "overrides"],
      });
      toast({ title: "Photo hidden" });
    },
    onError: (e: any) => {
      toast({
        title: "Hide failed",
        description: e?.message || "Could not hide photo",
        variant: "destructive",
      });
    },
  });

  const unhidePhoto = useMutation({
    mutationFn: (photoUrl: string) =>
      apiUnhideSpeciesPhoto(speciesIdNum!, photoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesIdNum, "overrides"],
      });
      toast({ title: "Photo restored" });
    },
  });

  const forceHeroMut = useMutation({
    mutationFn: (photoUrl: string | null) =>
      apiForceHeroPhoto(speciesIdNum!, photoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesIdNum, "overrides"],
      });
      // Drop local carousel selection so the new persisted hero takes effect.
      setSelectedPhoto(null);
      toast({ title: "Hero photo updated" });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't set hero",
        description: e?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  if (loadingTaxon) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <Skeleton className="aspect-[4/3] rounded-lg" />
          </div>
          <div className="lg:col-span-5 space-y-3">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!taxon) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="text-muted-foreground">Species not found.</div>
        <Link href="/browse" className="text-primary underline mt-4 inline-block">
          ← Back to species list
        </Link>
      </div>
    );
  }

  // Hero photo precedence:
  //   1. Admin-forced taxon photo (override.forcedHeroPhotoUrl, must match one
  //      of the iNat taxon_photos so the carousel and credits stay coherent)
  //   2. Admin-pinned or top-liked user record photo (from /top-photo endpoint)
  //   3. First iNat observation that has both photo + location
  //   4. Species-level taxon photo / default photo
  const forcedHeroUrl = override?.forcedHeroPhotoUrl?.trim() || null;
  const taxonPhotoEntries = (taxon.taxon_photos || [])
    .map((tp) => tp.photo)
    .filter((p): p is NonNullable<typeof p> => !!p && !!p.medium_url);
  // Hidden photos use the canonical url; match defensively against either field.
  const taxonPhotoHiddenSet = new Set(override?.hiddenPhotos || []);
  const isTaxonPhotoHidden = (p: { url?: string | null; medium_url?: string | null }) =>
    !!((p.url && taxonPhotoHiddenSet.has(p.url)) ||
       (p.medium_url && taxonPhotoHiddenSet.has(p.medium_url)));
  const visibleTaxonPhotos = taxonPhotoEntries.filter((p) => !isTaxonPhotoHidden(p));
  const forcedHeroPhoto = forcedHeroUrl
    ? visibleTaxonPhotos.find(
        (p) => p.url === forcedHeroUrl || p.medium_url === forcedHeroUrl,
      ) || null
    : null;

  const userHero =
    !forcedHeroPhoto && topPhotoData?.photoDataUrl ? topPhotoData : null;
  const heroObs = !forcedHeroPhoto && !userHero
    ? (obsData?.results || []).find(
        (o) => o.photos?.[0]?.url && o.place_guess,
      )
    : undefined;
  const defaultHeroPhoto = forcedHeroPhoto
    ? {
        url: forcedHeroPhoto.url || forcedHeroPhoto.medium_url || "",
        medium_url: forcedHeroPhoto.medium_url || forcedHeroPhoto.url || "",
        license_code: forcedHeroPhoto.license_code ?? null,
        attribution: forcedHeroPhoto.attribution ?? "iNaturalist",
      }
    : userHero
    ? {
        url: userHero.photoDataUrl!,
        medium_url: userHero.photoDataUrl!,
        license_code: null as string | null,
        attribution: userHero.author
          ? `© ${userHero.author.displayName || userHero.author.username}`
          : "Community contributor",
      }
    : heroObs
      ? {
          url: heroObs.photos[0].url,
          medium_url: heroObs.photos[0].url,
          license_code: heroObs.photos[0].license_code,
          attribution: heroObs.photos[0].attribution,
        }
      : visibleTaxonPhotos[0] || taxon.default_photo;

  // Lets users flick between top-rated taxon photos locally without changing
  // the persisted hero. selectedPhoto=null means "use defaultHeroPhoto above".
  const heroPhoto = selectedPhoto || defaultHeroPhoto;
  const heroLocation = selectedPhoto ? null : userHero ? null : heroObs?.place_guess ?? null;
  const heroObsId = selectedPhoto ? null : userHero ? null : heroObs?.id ?? null;
  const heroPhotoUrl = heroPhoto?.medium_url || heroPhoto?.url || null;

  // Common name + hidden-photo helpers (after overrides loaded).
  const displayCommonName =
    override?.commonNameOverride?.trim() ||
    taxon.preferred_common_name ||
    taxon.name;
  // Every other displayed field falls back to the upstream iNat / ALA value
  // when the override is null/empty. Empty string is treated the same as null
  // so editors can clear a value by submitting blank input.
  const pick = (a: string | null | undefined, b: string | null | undefined) =>
    (a && a.trim()) || (b ?? "") || "";
  const displayScientific = pick(override?.scientificNameOverride, taxon.name);
  const displayAuthority = pick(override?.authorityOverride, authority);
  const displayClass = pick(override?.classOverride, className);
  const displayOrder = pick(override?.orderOverride, order);
  const displayFamily = pick(override?.familyOverride, family);
  const displayDescription = pick(override?.descriptionOverride, summary);
  const displayHabitat = pick(override?.habitatOverride, facts.habitat);
  const displayDiet = pick(override?.dietOverride, facts.diet);
  const displaySize = pick(override?.sizeOverride, facts.size);
  const displayConservation =
    (override?.conservationOverride && override.conservationOverride.trim()) ||
    (taxon.conservation_status?.status_name ?? "");
  const displayLifecycle = override?.lifecycleOverride?.trim() || "";
  const displayBehaviour = override?.behaviourOverride?.trim() || "";
  const displayVenom = override?.venomOverride?.trim() || "";
  const displayRange = override?.rangeOverride?.trim() || "";
  const displayIdentification = override?.identificationOverride?.trim() || "";
  const displaySimilarSpecies = override?.similarSpeciesOverride?.trim() || "";
  const hiddenPhotoSet = new Set(override?.hiddenPhotos ?? []);
  const isHidden = (url: string | null | undefined) =>
    !!url && hiddenPhotoSet.has(url);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Top bar: back link on the left, Edit-species button on the right */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <BackButton fallback="/browse" label="Back" />
        {isEditorPlus && (
          <Button
            variant="outline"
            size="sm"
            onClick={openEditSpecies}
            data-testid="button-edit-species"
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit species profile
          </Button>
        )}
      </div>

      {/* Hero header */}
      <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 mb-12">
        <div className="lg:col-span-7">
          <div className="relative aspect-[4/3] sm:aspect-[16/10] rounded-lg overflow-hidden border border-border bg-muted">
            {heroPhoto?.medium_url ? (
              <img
                src={biggerPhoto(heroPhoto.medium_url, "large") || ""}
                alt={displayCommonName}
                className="w-full h-full object-cover"
                data-testid="img-species-hero"
              />
            ) : (
              <div className="w-full h-full grid place-items-center text-muted-foreground">
                <ImageOff className="h-12 w-12" />
              </div>
            )}
            {userHero && (
              <div
                className="absolute top-3 left-3 inline-flex items-center gap-1.5 bg-background/90 backdrop-blur px-2.5 py-1 rounded-full border border-border text-[11px] font-medium shadow-sm"
                data-testid="badge-hero-source"
              >
                {userHero.pinned ? (
                  <>
                    <Pin className="h-3 w-3 text-primary" />
                    Pinned by editor
                  </>
                ) : (
                  <>
                    <Heart className="h-3 w-3 text-red-500 fill-red-500" />
                    Top community photo
                    {typeof userHero.likeCount === "number" && (
                      <span className="text-muted-foreground">
                        {userHero.likeCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {heroPhoto?.attribution && (
            <PhotoCredit
              attribution={heroPhoto.attribution}
              license={heroPhoto.license_code}
              location={heroLocation}
              observationId={heroObsId}
            />
          )}

          {/* Top-rated taxon photos carousel. Renders thumbnails users can
              click to swap the displayed hero (local-only). Admins also get a
              Star (pin as hero) and X (hide photo) on each thumbnail. */}
          {visibleTaxonPhotos.length > 1 && (
            <div
              className="mt-4 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1"
              data-testid="species-photo-carousel"
              aria-label="Top-rated photos of this species"
            >
              {visibleTaxonPhotos.slice(0, 12).map((p, i) => {
                const thumbUrl = p.medium_url || p.url || "";
                if (!thumbUrl) return null;
                const isActive = thumbUrl === heroPhotoUrl;
                const isForced =
                  !!forcedHeroUrl &&
                  (p.url === forcedHeroUrl || p.medium_url === forcedHeroUrl);
                return (
                  <div
                    key={`${thumbUrl}-${i}`}
                    className="relative shrink-0 group"
                    data-testid={`carousel-thumb-${i}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPhoto({
                          url: p.url || thumbUrl,
                          medium_url: thumbUrl,
                          license_code: p.license_code ?? null,
                          attribution: p.attribution ?? "iNaturalist",
                        })
                      }
                      className={`block h-16 w-20 sm:h-20 sm:w-28 overflow-hidden rounded-md border transition ${
                        isActive
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-foreground/30"
                      }`}
                      aria-label={`Show photo ${i + 1}${isActive ? " (current)" : ""}`}
                      aria-pressed={isActive}
                    >
                      <img
                        src={thumbUrl}
                        alt={`${displayCommonName} photo ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                    {isForced && (
                      <span
                        className="absolute top-1 left-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground shadow"
                        title="Pinned as hero"
                        data-testid={`carousel-pinned-badge-${i}`}
                      >
                        <Pin className="h-3 w-3" />
                      </span>
                    )}
                    {isAdminPlus && (
                      <div className="absolute -top-1.5 -right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            forceHeroMut.mutate(
                              isForced ? null : p.url || thumbUrl,
                            );
                          }}
                          disabled={forceHeroMut.isPending}
                          className="h-6 w-6 grid place-items-center rounded-full bg-background border border-border shadow hover:bg-accent disabled:opacity-50"
                          title={isForced ? "Unpin as hero" : "Pin as hero"}
                          data-testid={`carousel-pin-${i}`}
                          aria-label={isForced ? "Unpin as hero" : "Pin as hero"}
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${
                              isForced ? "fill-primary text-primary" : ""
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (thumbUrl === heroPhotoUrl) setSelectedPhoto(null);
                            hidePhoto.mutate(p.url || thumbUrl);
                          }}
                          disabled={hidePhoto.isPending}
                          className="h-6 w-6 grid place-items-center rounded-full bg-background border border-border shadow hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                          title="Hide this photo"
                          data-testid={`carousel-hide-${i}`}
                          aria-label="Hide photo"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
            {displayClass === "Amphibia" ? "Amphibian" : "Reptile"}
            {displayFamily ? ` · ${displayFamily}` : ""}
            {isSubspecies && <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/40 text-foreground">Subspecies</span>}
          </div>
          {isSubspecies && parentTaxon && (
            <div className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/40 text-sm">
              <span className="text-muted-foreground">Subspecies of</span>
              <Link
                href={`/species/${parentTaxon.id}`}
                className="font-medium hover:underline"
                data-testid="link-parent-species"
              >
                {parentTaxon.preferred_common_name || parentTaxon.name}
              </Link>
              <span className="font-serif italic text-muted-foreground">({parentTaxon.name})</span>
            </div>
          )}
          <h1 className="font-serif text-4xl sm:text-5xl font-semibold tracking-tight leading-tight mb-2 flex items-center gap-3 flex-wrap" data-testid="text-species-title">
            <span>{displayCommonName}</span>
            {user ? (
              mySpeciesCount > 0 ? (
                <SeenBadge count={mySpeciesCount} variant="dot" className="w-8 h-8" />
              ) : (
                <UnseenBadge variant="dot" className="w-8 h-8" />
              )
            ) : null}
          </h1>
          <p className="font-serif text-xl text-muted-foreground mb-1" data-testid="text-species-scientific">
            <span className="italic">{displayScientific}</span>
            {displayAuthority && (
              <span
                className="not-italic ml-2 text-foreground/80"
                data-testid="text-species-authority"
              >
                {displayAuthority}
              </span>
            )}
          </p>



          {/* Taxonomy strip */}
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-border pt-4">
            {displayClass && <Field label="Class">{displayClass}</Field>}
            {displayOrder && <Field label="Order">{displayOrder}</Field>}
            {displayFamily && <Field label="Family">{displayFamily}</Field>}
            {displayAuthority && <Field label="Described">{displayAuthority}</Field>}
          </dl>

          {/* Conservation status sits beneath the taxonomy strip in the hero */}
          <div className="mt-4">
            <ConservationStatusCard
              statuses={taxon.conservation_statuses_au}
              fallback={
                override?.conservationOverride?.trim() ||
                taxon.conservation_status?.status_name ||
                undefined
              }
            />
          </div>

          {!isSubspecies && subspeciesChildren && subspeciesChildren.subspecies.length > 0 && (
            <div className="mt-6 border-t border-border pt-4" data-testid="section-subspecies">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Subspecies ({subspeciesChildren.subspecies.length})
              </div>
              <ul className="space-y-1">
                {subspeciesChildren.subspecies.map((sub) => (
                  <li key={sub.id}>
                    <Link
                      href={`/species/${sub.id}`}
                      className="text-sm hover:underline inline-flex items-baseline gap-2"
                      data-testid={`link-subspecies-${sub.id}`}
                    >
                      <span className="font-serif italic">{sub.scientific}</span>
                      {sub.common && (
                        <span className="text-muted-foreground text-xs">— {sub.common}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      </div>

      {/* Editor-added override notes shown above wiki summary */}
      {override?.notesOverride && (
        <div
          className="mb-8 border-l-4 border-primary/60 bg-accent/20 rounded-r-md px-4 py-3 max-w-3xl"
          data-testid="text-species-notes-override"
        >
          <div className="text-[11px] uppercase tracking-wider text-primary font-semibold mb-1">
            Editor notes
          </div>
          <p className="font-serif text-base leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {override.notesOverride}
          </p>
        </div>
      )}

      {/* Your records + Top recorders + Top identifiers */}
      <Section title="Field records">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* My records card */}
          <div className="border border-border rounded-lg p-5 bg-card">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary font-semibold mb-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Your records
            </div>
            {user ? (
              statsData ? (
                statsData.myCount > 0 ? (
                  <>
                    <div className="font-serif text-3xl font-semibold tracking-tight" data-testid="text-my-species-count">
                      {statsData.myCount}
                      <span className="text-base text-muted-foreground ml-2 font-sans font-normal">
                        record{statsData.myCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      You've found this species before. Add another sighting from{" "}
                      <Link href="/new" className="text-primary hover:underline">Add Record</Link>.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="font-serif text-3xl font-semibold tracking-tight text-muted-foreground">
                      0
                      <span className="text-base ml-2 font-sans font-normal">records</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      You haven't recorded this species yet.{" "}
                      <Link href="/new" className="text-primary hover:underline">Add your first sighting</Link>.
                    </p>
                  </>
                )
              ) : (
                <Skeleton className="h-10 w-32" />
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                <Link href="/login" className="text-primary hover:underline">Log in</Link>{" "}
                to track your sightings of this species.
              </p>
            )}
          </div>

          {/* Top recorders card */}
          <div className="border border-border rounded-lg p-5 bg-card">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
              <Trophy className="h-3.5 w-3.5" />
              Top recorders
            </div>
            {statsData ? (
              statsData.topRecorders.length > 0 ? (
                <ol className="space-y-2">
                  {statsData.topRecorders.map((t, i) => (
                    <li
                      key={t.user?.id ?? i}
                      className="flex items-center justify-between gap-3 text-sm"
                      data-testid={`row-top-recorder-${i}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                          {i + 1}.
                        </span>
                        {t.user ? (
                          <Link
                            href={`/u/${t.user.username}`}
                            className="font-medium hover:text-primary hover:underline truncate"
                          >
                            {t.user.displayName || t.user.username}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {t.recordCount} {t.recordCount === 1 ? "record" : "records"}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No field records yet. Be the first to record this species.
                </p>
              )
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
          </div>

          {/* Top identifiers card */}
          <div className="border border-border rounded-lg p-5 bg-card">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
              <BadgeCheck className="h-3.5 w-3.5" />
              Top identifiers
            </div>
            {statsData ? (
              statsData.topIdentifiers && statsData.topIdentifiers.length > 0 ? (
                <ol className="space-y-2">
                  {statsData.topIdentifiers.map((t, i) => (
                    <li
                      key={t.user?.id ?? i}
                      className="flex items-center justify-between gap-3 text-sm"
                      data-testid={`row-top-identifier-${i}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                          {i + 1}.
                        </span>
                        {t.user ? (
                          <Link
                            href={`/u/${t.user.username}`}
                            className="font-medium hover:text-primary hover:underline truncate"
                          >
                            {t.user.displayName || t.user.username}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {t.idCount} {t.idCount === 1 ? "ID" : "IDs"}
                        {t.acceptedCount > 0 && (
                          <span className="ml-1 opacity-70">({t.acceptedCount} accepted)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No identifications yet.
                </p>
              )
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Tabbed content: Information, Scientific articles, Records, Observation notes */}
      <Tabs defaultValue="information" className="mt-2">
        <TabsList className="w-full sm:w-auto flex flex-wrap">
          <TabsTrigger value="information" data-testid="tab-information">
            Information
          </TabsTrigger>
          <TabsTrigger value="articles" data-testid="tab-articles">
            Scientific articles
          </TabsTrigger>
          <TabsTrigger value="records" data-testid="tab-records">
            Records
          </TabsTrigger>
          <TabsTrigger value="notes" data-testid="tab-notes">
            Observation notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="information" className="mt-4">
      {/* Description + Habitat prose flows to the left of the Distribution map;
          once the prose runs past the map height, text expands to full width. */}
      <section className="mt-10">
        <div className="clear-both">
          {/* Distribution map floats right on ≥lg, full width on mobile */}
          <div
            className="mb-6 lg:mb-4 lg:float-right lg:ml-8 lg:w-[46%] xl:w-[44%]"
            data-testid="compact-distribution"
          >
            <h2 className="font-serif text-2xl font-semibold tracking-tight mb-4">
              Distribution
            </h2>
            <GridDistributionMap
              speciesId={Number(id!)}
              isAdmin={!!user?.capabilities?.editDistribution}
              height={360}
            />
            <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
              0.5° (≈50 km) cells shaded by record density. Sources:
              iNaturalist + ALA + Users Field Records.
            </p>
          </div>
          {/* Prose: wraps around the map while it's there, then expands. */}
          <div className="min-w-0">
            <h2 className="font-serif text-2xl font-semibold tracking-tight mb-4">
              Description
            </h2>
            {displayDescription ? (
              <p className="font-serif text-lg leading-relaxed text-foreground/85 whitespace-pre-wrap">
                {displayDescription}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description available yet for this species.
              </p>
            )}
            {displayHabitat && (
              <div className="mt-8">
                <h2 className="font-serif text-2xl font-semibold tracking-tight mb-4">
                  Habitat
                </h2>
                <p className="font-serif text-lg leading-relaxed text-foreground/85 whitespace-pre-wrap">
                  {displayHabitat}
                </p>
              </div>
            )}
          </div>
          {/* Clear the float so any later sections start full-width below */}
          <div className="clear-both" />
        </div>
      </section>


      {displayDiet && (
        <Section title="Diet">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displayDiet}
          </p>
        </Section>
      )}

      {displaySize && (
        <Section title="Size">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displaySize}
          </p>
        </Section>
      )}

      {displayLifecycle && (
        <Section title="Lifecycle & breeding">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displayLifecycle}
          </p>
        </Section>
      )}

      {displayBehaviour && (
        <Section title="Behaviour">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displayBehaviour}
          </p>
        </Section>
      )}

      {displayVenom && (
        <Section title="Venom & defence">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displayVenom}
          </p>
        </Section>
      )}

      {displayRange && (
        <Section title="Range">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displayRange}
          </p>
        </Section>
      )}

      {displayIdentification && (
        <Section title="Identification">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displayIdentification}
          </p>
        </Section>
      )}

      {displaySimilarSpecies && (
        <Section title="Similar species">
          <p className="font-serif text-lg leading-relaxed text-foreground/85 max-w-3xl whitespace-pre-wrap">
            {displaySimilarSpecies}
          </p>
        </Section>
      )}

      {/* Morphology — scale counts for snakes, length for lizards, size for amphibians */}
      {morphGroup && (
        <MorphologySection
          group={morphGroup}
          data={morphData}
          loading={loadingMorph}
          override={override}
        />
      )}

        </TabsContent>

        <TabsContent value="articles" className="mt-4">
          <ScientificArticlesTab speciesId={taxon.id} />
        </TabsContent>

        <TabsContent value="records" className="mt-4">
          {/* Unified Records list: iNaturalist observations + Hunt Herpetology app records */}
          <RecordsList
            loading={loadingObs || loadingSpeciesRecords}
            inatObservations={obsData?.results || []}
            appRecords={speciesRecords}
            displayCommonName={displayCommonName}
            isAdminPlus={isAdminPlus}
            isHidden={isHidden}
            hidePhoto={hidePhoto}
            unhidePhoto={unhidePhoto}
          />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <SpeciesNotesTab speciesId={taxon.id} />
        </TabsContent>
      </Tabs>

      {/* Source acknowledgment */}
      <div className="text-xs text-muted-foreground border-t border-border pt-6 mt-12 leading-relaxed">
        Species record, summary text, and photos are aggregated from{" "}
        <a
          href={`https://www.inaturalist.org/taxa/${taxon.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-primary"
        >
          iNaturalist
        </a>{" "}
        and the{" "}
        <a
          href="https://www.ala.org.au/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-primary"
        >
          Atlas of Living Australia
        </a>
        . Photo credits and licenses are shown beneath every shot.
      </div>

      {/* Edit-species dialog (editor+) */}
      <Dialog open={editSpeciesOpen} onOpenChange={setEditSpeciesOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-edit-species">
          <DialogHeader>
            <DialogTitle>Edit species profile</DialogTitle>
            <DialogDescription>
              Override any part of the species profile. Leave a field blank to
              fall back to the upstream value shown as a placeholder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <SpeciesEditFields
              editCommonName={editCommonName} setEditCommonName={setEditCommonName}
              editScientific={editScientific} setEditScientific={setEditScientific}
              editAuthority={editAuthority} setEditAuthority={setEditAuthority}
              editClass={editClass} setEditClass={setEditClass}
              editOrder={editOrder} setEditOrder={setEditOrder}
              editFamily={editFamily} setEditFamily={setEditFamily}
              editConservation={editConservation} setEditConservation={setEditConservation}
              editDescription={editDescription} setEditDescription={setEditDescription}
              editHabitat={editHabitat} setEditHabitat={setEditHabitat}
              editDiet={editDiet} setEditDiet={setEditDiet}
              editSize={editSize} setEditSize={setEditSize}
              editNotes={editNotes} setEditNotes={setEditNotes}
              editTotalLength={editTotalLength} setEditTotalLength={setEditTotalLength}
              editSnoutVent={editSnoutVent} setEditSnoutVent={setEditSnoutVent}
              editBodyLength={editBodyLength} setEditBodyLength={setEditBodyLength}
              editDorsalScales={editDorsalScales} setEditDorsalScales={setEditDorsalScales}
              editVentralScales={editVentralScales} setEditVentralScales={setEditVentralScales}
              editSubcaudalScales={editSubcaudalScales} setEditSubcaudalScales={setEditSubcaudalScales}
              editAnalScale={editAnalScale} setEditAnalScale={setEditAnalScale}
              editLifecycle={editLifecycle} setEditLifecycle={setEditLifecycle}
              editBehaviour={editBehaviour} setEditBehaviour={setEditBehaviour}
              editVenom={editVenom} setEditVenom={setEditVenom}
              editRange={editRange} setEditRange={setEditRange}
              editIdentification={editIdentification} setEditIdentification={setEditIdentification}
              editSimilarSpecies={editSimilarSpecies} setEditSimilarSpecies={setEditSimilarSpecies}
              morphGroup={morphGroup}
              morphFields={morphData?.fields}
              taxon={taxon}
              authority={authority}
              className_={className}
              order={order}
              family={family}
              summary={summary}
              facts={facts}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pinned hero record
              </label>
              <Select value={editHeroId || "none"} onValueChange={(v) => setEditHeroId(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="select-edit-hero">
                  <SelectValue placeholder="Use top-liked photo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use top-liked photo</SelectItem>
                  {speciesRecords.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      #{r.id} · {r.placeGuess || "Unknown location"}
                      {r.author?.username ? ` · @${r.author.username}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pinned record overrides the top-liked photo on the hero image.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditSpeciesOpen(false)}
              data-testid="button-cancel-edit-species"
            >
              Cancel
            </Button>
            <Button
              onClick={() => patchSpecies.mutate()}
              disabled={patchSpecies.isPending}
              data-testid="button-save-edit-species"
            >
              {patchSpecies.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function titleCase(s: string | null | undefined) {
  if (!s) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl font-semibold tracking-tight mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="font-medium text-sm mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * Conservation-status card showing federal (EPBC) + per-state listings.
 * Always renders all 9 jurisdictions so absence-of-listing is explicit.
 * Background tint is chosen per-status so threatened categories stand out.
 */
const CONSERVATION_ROWS: Array<{ key: "AUS" | "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA"; label: string }> = [
  { key: "AUS", label: "National (EPBC)" },
  { key: "ACT", label: "ACT" },
  { key: "NSW", label: "NSW" },
  { key: "NT", label: "NT" },
  { key: "QLD", label: "QLD" },
  { key: "SA", label: "SA" },
  { key: "TAS", label: "TAS" },
  { key: "VIC", label: "VIC" },
  { key: "WA", label: "WA" },
];

function statusTone(status: string | undefined): string {
  if (!status) return "text-muted-foreground";
  const s = status.toLowerCase();
  if (s.includes("extinct")) return "text-rose-700 dark:text-rose-300 font-medium";
  if (s.includes("critically")) return "text-rose-700 dark:text-rose-300 font-medium";
  if (s.includes("endangered")) return "text-orange-700 dark:text-orange-300 font-medium";
  if (s.includes("vulnerable")) return "text-amber-700 dark:text-amber-300 font-medium";
  if (s.includes("near")) return "text-yellow-700 dark:text-yellow-300";
  if (s.includes("least") || s.includes("not listed")) return "text-muted-foreground";
  return "text-foreground";
}

function ConservationStatusCard({
  statuses,
  fallback,
}: {
  statuses?: Partial<Record<string, { status: string; dr?: string }>>;
  fallback?: string;
}) {
  const hasAny = statuses && Object.keys(statuses).length > 0;
  return (
    <div
      className="mt-6 border border-border rounded-lg bg-card p-4"
      data-testid="card-conservation-status"
    >
      <div className="text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
        Conservation status
      </div>
      {hasAny ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {CONSERVATION_ROWS.map((row) => {
            const entry = statuses?.[row.key];
            return (
              <div
                key={row.key}
                className="flex items-baseline justify-between gap-3"
                data-testid={`conservation-row-${row.key}`}
              >
                <dt className="text-muted-foreground text-xs">{row.label}</dt>
                <dd className={`text-xs ${statusTone(entry?.status)}`}>
                  {entry?.status ?? "Not listed"}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : fallback ? (
        <p className="text-sm text-foreground/85">{fallback}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Not listed under EPBC or any Australian state/territory legislation.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground mt-3 leading-snug">
        Source: Atlas of Living Australia. AUS = federal EPBC Act listing.
      </p>
    </div>
  );
}

function FactCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-[11px] uppercase tracking-wider text-primary font-semibold mb-1.5">
        {label}
      </div>
      <p className="text-sm leading-relaxed text-foreground/85">{children}</p>
    </div>
  );
}

function ProseCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-[11px] uppercase tracking-wider text-primary font-semibold mb-2">
        {label}
      </div>
      <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">
        {children}
      </p>
    </div>
  );
}


function MorphologySection({
  group,
  data,
  loading,
  override,
}: {
  group: "snake" | "lizard" | "amphibian";
  data: MorphologyResponse | undefined;
  loading: boolean;
  override: SpeciesOverride | undefined;
}) {
  const title =
    group === "snake"
      ? "Morphology & scale counts"
      : group === "lizard"
        ? "Morphology"
        : "Size";
  const fields = data?.fields || {};
  const dash = <span className="text-muted-foreground">{"\u2014"}</span>;

  // Override > parsed-value > dash. Overrides are simple text strings; parsed
  // values come with a `source` sentence we surface on hover.
  const cell = (
    f: { value: string; source: string } | null | undefined,
    ovr: string | null | undefined,
  ): React.ReactNode => {
    const o = ovr?.trim();
    if (o) return <span className="font-mono">{o}</span>;
    if (loading) return <Skeleton className="h-4 w-24" />;
    if (!f) return dash;
    return <span className="font-mono">{f.value}</span>;
  };

  const tip = (
    f: { value: string; source: string } | null | undefined,
    ovr: string | null | undefined,
  ): string | undefined => {
    if (ovr?.trim()) return undefined;
    return f ? `From Wikipedia: "${f.source}"` : undefined;
  };

  return (
    <Section title={title}>
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Body measurements and scale counts for this species. A dash means no
        value is available.
      </p>
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/40">
          <Ruler className="h-4 w-4 text-primary" />
          <span className="text-xs uppercase tracking-wider font-semibold text-primary">
            {group === "snake"
              ? "Snake morphology"
              : group === "lizard"
                ? "Lizard morphology"
                : "Amphibian size"}
          </span>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {(group === "snake" || group === "lizard") && (
            <>
              <div className="px-4 py-3" title={tip(fields.totalLength, override?.totalLengthOverride)}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Total length
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{cell(fields.totalLength, override?.totalLengthOverride)}</dd>
              </div>
              <div className="px-4 py-3" title={tip(fields.snoutVent, override?.snoutVentOverride)}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Snout-vent length (SVL)
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{cell(fields.snoutVent, override?.snoutVentOverride)}</dd>
              </div>
            </>
          )}
          {group === "amphibian" && (
            <div className="px-4 py-3 sm:col-span-2" title={tip(fields.size, override?.bodyLengthOverride)}>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Body length
              </dt>
              <dd className="mt-0.5 text-sm font-medium">{cell(fields.size, override?.bodyLengthOverride)}</dd>
            </div>
          )}
        </dl>

        {group === "snake" && (
          <>
            <div className="px-4 py-3 border-t border-border bg-muted/30">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">
                Scale counts
              </span>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
              <div className="px-4 py-3" title={tip(fields.dorsalScales, override?.dorsalScalesOverride)}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Dorsal (midbody)
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{cell(fields.dorsalScales, override?.dorsalScalesOverride)}</dd>
              </div>
              <div className="px-4 py-3" title={tip(fields.ventralScales, override?.ventralScalesOverride)}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Ventral
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{cell(fields.ventralScales, override?.ventralScalesOverride)}</dd>
              </div>
              <div className="px-4 py-3" title={tip(fields.subcaudalScales, override?.subcaudalScalesOverride)}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Subcaudal
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{cell(fields.subcaudalScales, override?.subcaudalScalesOverride)}</dd>
              </div>
              <div className="px-4 py-3" title={tip(fields.analScale, override?.analScaleOverride)}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Anal plate
                </dt>
                <dd className="mt-0.5 text-sm font-medium capitalize">{cell(fields.analScale, override?.analScaleOverride)}</dd>
              </div>
            </dl>
          </>
        )}

      </div>
    </Section>
  );
}

function PhotoCredit({
  attribution,
  license,
  location,
  observationId,
}: {
  attribution: string;
  license: string | null;
  location?: string | null;
  observationId?: number | null;
}) {
  const lic = licenseInfo(license);
  const cleaned = attribution
    .replace(/\(c\)\s*/i, "© ")
    .replace(/,?\s*some rights reserved.*$/i, "")
    .replace(/,?\s*no rights reserved.*$/i, "")
    .replace(/,?\s*all rights reserved.*$/i, "")
    .trim();
  return (
    <div className="text-xs text-muted-foreground mt-2 px-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        Photo {cleaned}
        {" · "}
        {lic.url ? (
          <a
            href={lic.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary"
          >
            {lic.label}
          </a>
        ) : (
          lic.label
        )}
      </span>
      {location && (
        <span
          className="inline-flex items-center gap-1 text-foreground/80"
          data-testid="text-hero-location"
        >
          <span className="text-muted-foreground">·</span>
          <MapPin className="h-3 w-3 text-primary" />
          {observationId ? (
            <a
              href={`https://www.inaturalist.org/observations/${observationId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary hover:underline"
            >
              {location}
            </a>
          ) : (
            <span>{location}</span>
          )}
        </span>
      )}
    </div>
  );
}

interface SpeciesEditFieldsProps {
  editCommonName: string; setEditCommonName: (v: string) => void;
  editScientific: string; setEditScientific: (v: string) => void;
  editAuthority: string; setEditAuthority: (v: string) => void;
  editClass: string; setEditClass: (v: string) => void;
  editOrder: string; setEditOrder: (v: string) => void;
  editFamily: string; setEditFamily: (v: string) => void;
  editConservation: string; setEditConservation: (v: string) => void;
  editDescription: string; setEditDescription: (v: string) => void;
  editHabitat: string; setEditHabitat: (v: string) => void;
  editDiet: string; setEditDiet: (v: string) => void;
  editSize: string; setEditSize: (v: string) => void;
  editNotes: string; setEditNotes: (v: string) => void;
  editTotalLength: string; setEditTotalLength: (v: string) => void;
  editSnoutVent: string; setEditSnoutVent: (v: string) => void;
  editBodyLength: string; setEditBodyLength: (v: string) => void;
  editDorsalScales: string; setEditDorsalScales: (v: string) => void;
  editVentralScales: string; setEditVentralScales: (v: string) => void;
  editSubcaudalScales: string; setEditSubcaudalScales: (v: string) => void;
  editAnalScale: string; setEditAnalScale: (v: string) => void;
  editLifecycle: string; setEditLifecycle: (v: string) => void;
  editBehaviour: string; setEditBehaviour: (v: string) => void;
  editVenom: string; setEditVenom: (v: string) => void;
  editRange: string; setEditRange: (v: string) => void;
  editIdentification: string; setEditIdentification: (v: string) => void;
  editSimilarSpecies: string; setEditSimilarSpecies: (v: string) => void;
  morphGroup: "snake" | "lizard" | "amphibian" | null | undefined;
  morphFields: {
    totalLength?: { value: string; source: string } | null;
    snoutVent?: { value: string; source: string } | null;
    dorsalScales?: { value: string; source: string } | null;
    ventralScales?: { value: string; source: string } | null;
    subcaudalScales?: { value: string; source: string } | null;
    analScale?: { value: string; source: string } | null;
    size?: { value: string; source: string } | null;
  } | undefined;
  taxon: any;
  authority: string | null | undefined;
  className_: string | null | undefined;
  order: string | null | undefined;
  family: string | null | undefined;
  summary: string;
  facts: { habitat?: string; diet?: string; size?: string };
}

function SpeciesEditFields(p: SpeciesEditFieldsProps) {
  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>
  );
  const FieldLabel = ({ children }: { children: React.ReactNode }) => (
    <label className="text-xs font-medium text-muted-foreground">{children}</label>
  );
  return (
    <>
      {/* Identity */}
      <div className="space-y-3">
        <SectionLabel>Identity</SectionLabel>
        <div className="space-y-1.5">
          <FieldLabel>Common name</FieldLabel>
          <Input
            value={p.editCommonName}
            onChange={(e) => p.setEditCommonName(e.target.value)}
            placeholder={p.taxon.preferred_common_name || p.taxon.name}
            data-testid="input-edit-common-name"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <FieldLabel>Scientific name</FieldLabel>
            <Input
              value={p.editScientific}
              onChange={(e) => p.setEditScientific(e.target.value)}
              placeholder={p.taxon.name}
              data-testid="input-edit-scientific"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Authority (describer, year)</FieldLabel>
            <Input
              value={p.editAuthority}
              onChange={(e) => p.setEditAuthority(e.target.value)}
              placeholder={p.authority || "e.g. Linnaeus, 1758"}
              data-testid="input-edit-authority"
            />
          </div>
        </div>
      </div>

      {/* Taxonomy */}
      <div className="space-y-3">
        <SectionLabel>Taxonomy</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <FieldLabel>Class</FieldLabel>
            <Input
              value={p.editClass}
              onChange={(e) => p.setEditClass(e.target.value)}
              placeholder={p.className_ || "Reptilia / Amphibia"}
              data-testid="input-edit-class"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Order</FieldLabel>
            <Input
              value={p.editOrder}
              onChange={(e) => p.setEditOrder(e.target.value)}
              placeholder={p.order || "Squamata"}
              data-testid="input-edit-order"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Family</FieldLabel>
            <Input
              value={p.editFamily}
              onChange={(e) => p.setEditFamily(e.target.value)}
              placeholder={p.family || "Elapidae"}
              data-testid="input-edit-family"
            />
          </div>
        </div>
      </div>

      {/* Conservation */}
      <div className="space-y-3">
        <SectionLabel>Conservation</SectionLabel>
        <div className="space-y-1.5">
          <FieldLabel>Conservation status</FieldLabel>
          <Input
            value={p.editConservation}
            onChange={(e) => p.setEditConservation(e.target.value)}
            placeholder={p.taxon.conservation_status?.status_name || "e.g. Least Concern, Vulnerable"}
            data-testid="input-edit-conservation"
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-3">
        <SectionLabel>Description</SectionLabel>
        <div className="space-y-1.5">
          <FieldLabel>Description (replaces Wikipedia summary when set)</FieldLabel>
          <Textarea
            value={p.editDescription}
            onChange={(e) => p.setEditDescription(e.target.value)}
            rows={6}
            placeholder={p.summary || "Overview of the species — appearance, range, behaviour…"}
            data-testid="textarea-edit-description"
          />
        </div>
      </div>

      {/* Natural history */}
      <div className="space-y-3">
        <SectionLabel>Natural history</SectionLabel>
        <div className="space-y-1.5">
          <FieldLabel>Habitat</FieldLabel>
          <Textarea
            value={p.editHabitat}
            onChange={(e) => p.setEditHabitat(e.target.value)}
            rows={3}
            placeholder={p.facts.habitat || "Preferred habitats, microhabitats, elevation range…"}
            data-testid="textarea-edit-habitat"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Diet</FieldLabel>
          <Textarea
            value={p.editDiet}
            onChange={(e) => p.setEditDiet(e.target.value)}
            rows={3}
            placeholder={p.facts.diet || "Prey items, feeding behaviour…"}
            data-testid="textarea-edit-diet"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Size</FieldLabel>
          <Textarea
            value={p.editSize}
            onChange={(e) => p.setEditSize(e.target.value)}
            rows={2}
            placeholder={p.facts.size || "Average / max body length, mass…"}
            data-testid="textarea-edit-size"
          />
        </div>
      </div>

      {/* Morphology / size */}
      {p.morphGroup && (
        <div className="space-y-3">
          <SectionLabel>
            {p.morphGroup === "snake"
              ? "Morphology & scale counts"
              : p.morphGroup === "lizard"
                ? "Morphology"
                : "Size"}
          </SectionLabel>
          <MorphologyEditFields p={p} />
        </div>
      )}

      {/* Ecology & identification */}
      <div className="space-y-3">
        <SectionLabel>Ecology &amp; identification</SectionLabel>
        <div className="space-y-1.5">
          <FieldLabel>Lifecycle &amp; breeding</FieldLabel>
          <Textarea
            value={p.editLifecycle}
            onChange={(e) => p.setEditLifecycle(e.target.value)}
            rows={4}
            placeholder="Reproduction (oviparous / viviparous), clutch / litter size, egg incubation, gestation, hatchling size, sexual maturity, lifespan…"
            data-testid="textarea-edit-lifecycle"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Behaviour</FieldLabel>
          <Textarea
            value={p.editBehaviour}
            onChange={(e) => p.setEditBehaviour(e.target.value)}
            rows={3}
            placeholder="Activity (diurnal / nocturnal / crepuscular), temperament, social behaviour, seasonality…"
            data-testid="textarea-edit-behaviour"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Venom &amp; defence</FieldLabel>
          <Textarea
            value={p.editVenom}
            onChange={(e) => p.setEditVenom(e.target.value)}
            rows={3}
            placeholder="Venom toxicity, medical significance, antivenom, defensive behaviour…"
            data-testid="textarea-edit-venom"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Range</FieldLabel>
          <Textarea
            value={p.editRange}
            onChange={(e) => p.setEditRange(e.target.value)}
            rows={3}
            placeholder="Geographic distribution — states, bioregions, elevation…"
            data-testid="textarea-edit-range"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Identification</FieldLabel>
          <Textarea
            value={p.editIdentification}
            onChange={(e) => p.setEditIdentification(e.target.value)}
            rows={4}
            placeholder="Diagnostic features, key characters, colour pattern variation…"
            data-testid="textarea-edit-identification"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Similar species</FieldLabel>
          <Textarea
            value={p.editSimilarSpecies}
            onChange={(e) => p.setEditSimilarSpecies(e.target.value)}
            rows={3}
            placeholder="Species that are commonly confused with this one and how to tell them apart…"
            data-testid="textarea-edit-similar-species"
          />
        </div>
      </div>

      {/* Editor notes */}
      <div className="space-y-3">
        <SectionLabel>Editor notes</SectionLabel>
        <div className="space-y-1.5">
          <FieldLabel>Notes (shown above description)</FieldLabel>
          <Textarea
            value={p.editNotes}
            onChange={(e) => p.setEditNotes(e.target.value)}
            rows={4}
            placeholder="Field guide notes, ID tips, regional info…"
            data-testid="textarea-edit-notes"
          />
        </div>
      </div>
    </>
  );
}

function MorphologyEditFields({ p }: { p: SpeciesEditFieldsProps }) {
  const FieldLabel = ({ children }: { children: React.ReactNode }) => (
    <label className="text-xs font-medium text-muted-foreground">{children}</label>
  );
  return (
    <>
      {(p.morphGroup === "snake" || p.morphGroup === "lizard") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <FieldLabel>Total length</FieldLabel>
            <Input
              value={p.editTotalLength}
              onChange={(e) => p.setEditTotalLength(e.target.value)}
              placeholder={p.morphFields?.totalLength?.value || "e.g. up to 1.5 m"}
              data-testid="input-edit-total-length"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Snout-vent length (SVL)</FieldLabel>
            <Input
              value={p.editSnoutVent}
              onChange={(e) => p.setEditSnoutVent(e.target.value)}
              placeholder={p.morphFields?.snoutVent?.value || "e.g. 90 cm"}
              data-testid="input-edit-snout-vent"
            />
          </div>
        </div>
      )}
      {p.morphGroup === "amphibian" && (
        <div className="space-y-1.5">
          <FieldLabel>Body length</FieldLabel>
          <Input
            value={p.editBodyLength}
            onChange={(e) => p.setEditBodyLength(e.target.value)}
            placeholder={p.morphFields?.size?.value || "e.g. 10 cm (4 in)"}
            data-testid="input-edit-body-length"
          />
        </div>
      )}
      {p.morphGroup === "snake" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <FieldLabel>Dorsal (midbody)</FieldLabel>
            <Input
              value={p.editDorsalScales}
              onChange={(e) => p.setEditDorsalScales(e.target.value)}
              placeholder={p.morphFields?.dorsalScales?.value || "e.g. 17"}
              data-testid="input-edit-dorsal"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Ventral</FieldLabel>
            <Input
              value={p.editVentralScales}
              onChange={(e) => p.setEditVentralScales(e.target.value)}
              placeholder={p.morphFields?.ventralScales?.value || "e.g. 180–210"}
              data-testid="input-edit-ventral"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Subcaudal</FieldLabel>
            <Input
              value={p.editSubcaudalScales}
              onChange={(e) => p.setEditSubcaudalScales(e.target.value)}
              placeholder={p.morphFields?.subcaudalScales?.value || "e.g. 40–60"}
              data-testid="input-edit-subcaudal"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Anal plate</FieldLabel>
            <Input
              value={p.editAnalScale}
              onChange={(e) => p.setEditAnalScale(e.target.value)}
              placeholder={p.morphFields?.analScale?.value || "single / divided"}
              data-testid="input-edit-anal"
            />
          </div>
        </div>
      )}
    </>
  );
}

// =====================================================================
// Unified Records list — combines iNaturalist observations with app records
// =====================================================================
type InatObs = ObservationsResponse["results"][number];

interface RecordsListProps {
  loading: boolean;
  inatObservations: InatObs[];
  appRecords: AppRecord[];
  displayCommonName: string;
  isAdminPlus: boolean;
  isHidden: (url: string) => boolean;
  hidePhoto: { mutate: (url: string) => void; isPending: boolean };
  unhidePhoto: { mutate: (url: string) => void; isPending: boolean };
}

interface UnifiedRecord {
  key: string;
  photoUrl: string | null;
  hiddenKey: string | null; // null for app records (no hide for those yet)
  location: string | null;
  date: string | null; // YYYY-MM-DD
  observer: string;
  /** Top identifier (display name + iNat profile URL) — iNat rows only. */
  topIdentifier: { name: string; profileUrl: string } | null;
  sourceLabel: string;
  sourceUrl: string;
  href: string; // where the row links to
  licenseLabel: string | null;
}

/**
 * Pick the top identifier for an iNat observation. iNat doesn’t expose
 * “who the community sided with” directly, but we approximate it: among
 * current identifications whose taxon matches the observation’s
 * community/research taxon, pick the earliest one (first to suggest the
 * winning ID). Falls back to the most recent current identification, then
 * to none if the observation owner is also the only identifier.
 */
function pickTopIdentifier(obs: {
  user?: { login?: string } | null;
  taxon?: { id?: number } | null;
  community_taxon_id?: number | null;
  identifications?: Array<{
    current: boolean;
    created_at?: string | null;
    taxon_id?: number | null;
    taxon?: { id?: number } | null;
    user?: { id?: number; login?: string; name?: string | null } | null;
  }>;
}): { name: string; profileUrl: string } | null {
  const ids = obs.identifications || [];
  if (ids.length === 0) return null;
  const winningTaxonId =
    obs.community_taxon_id ?? obs.taxon?.id ?? null;
  const ownerLogin = obs.user?.login?.toLowerCase() || null;
  const current = ids.filter((i) => i.current && i.user?.login);
  if (current.length === 0) return null;

  const matching = winningTaxonId
    ? current.filter(
        (i) => (i.taxon_id ?? i.taxon?.id) === winningTaxonId,
      )
    : current;
  const pool = matching.length > 0 ? matching : current;
  // Prefer identifiers other than the observation owner.
  const others = pool.filter(
    (i) => (i.user?.login?.toLowerCase() || "") !== ownerLogin,
  );
  const candidates = others.length > 0 ? others : pool;
  // Sort earliest first — the first person to land on the winning taxon
  // is the most meaningful “top identifier”.
  candidates.sort((a, b) => {
    const da = a.created_at ? Date.parse(a.created_at) : Infinity;
    const db = b.created_at ? Date.parse(b.created_at) : Infinity;
    return da - db;
  });
  const top = candidates[0];
  if (!top?.user?.login) return null;
  return {
    name: top.user.name?.trim() || top.user.login,
    profileUrl: `https://www.inaturalist.org/people/${top.user.login}`,
  };
}

function formatDateAu(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
}

function cleanAttribution(raw: string | null | undefined) {
  if (!raw) return "iNaturalist user";
  return raw
    .replace(/\(c\)\s*/i, "© ")
    .replace(/,?\s*some rights reserved.*$/i, "")
    .replace(/,?\s*no rights reserved.*$/i, "")
    .replace(/,?\s*all rights reserved.*$/i, "")
    .trim() || "iNaturalist user";
}

function RecordsList(props: RecordsListProps) {
  const {
    loading,
    inatObservations,
    appRecords,
    displayCommonName,
    isAdminPlus,
    isHidden,
    hidePhoto,
    unhidePhoto,
  } = props;

  // Build unified list
  const unified: UnifiedRecord[] = useMemo(() => {
    const inatRows: UnifiedRecord[] = inatObservations
      .map((obs): UnifiedRecord | null => {
        const photo = obs.photos?.[0];
        if (!photo) return null;
        const hiddenKey = photo.url;
        const hidden = isHidden(hiddenKey);
        // Hide from non-admins; admins see with "Hidden" overlay so they can unhide.
        if (hidden && !isAdminPlus) return null;
        const lic = licenseInfo(photo.license_code);
        return {
          key: `inat-${obs.id}`,
          photoUrl: biggerPhoto(photo.url, "medium") || photo.url,
          hiddenKey,
          location: obs.place_guess || null,
          date: obs.observed_on || null,
          observer: cleanAttribution(photo.attribution),
          topIdentifier: pickTopIdentifier(obs as any),
          sourceLabel: "iNaturalist",
          sourceUrl: `https://www.inaturalist.org/observations/${obs.id}`,
          href: `https://www.inaturalist.org/observations/${obs.id}`,
          licenseLabel: lic.label,
        };
      })
      .filter((x): x is UnifiedRecord => x !== null);

    const appRows: UnifiedRecord[] = appRecords.map((r) => {
      const firstPhoto = r.photoDataUrl || (r.photos && r.photos[0]) || null;
      const lic = r.licenseCode ? licenseInfo(r.licenseCode) : null;
      const observer = r.author?.name || r.author?.username || "Hunt Herpetology member";
      return {
        key: `app-${r.id}`,
        photoUrl: firstPhoto,
        hiddenKey: null,
        location: r.placeGuess || (r.lat != null && r.lng != null ? `${r.lat.toFixed(3)}, ${r.lng.toFixed(3)}` : null),
        date: r.observedOn || null,
        observer,
        topIdentifier: null,
        sourceLabel: "Hunt Herpetology",
        sourceUrl: `/r/${r.id}`,
        href: `/r/${r.id}`,
        licenseLabel: lic?.label || null,
      };
    });

    // Sort newest-first by date, falling back to original order.
    const combined = [...inatRows, ...appRows];
    combined.sort((a, b) => {
      const da = a.date ? Date.parse(a.date) : 0;
      const db = b.date ? Date.parse(b.date) : 0;
      return db - da;
    });
    return combined;
  }, [inatObservations, appRecords, isAdminPlus, isHidden]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (unified.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
        No records yet for this species.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Header row — md+ only */}
      <div className="hidden md:grid md:grid-cols-[80px_2fr_140px_1.5fr_140px] gap-4 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border bg-muted/40">
        <div>Photo</div>
        <div>Location</div>
        <div>Date</div>
        <div>Observer</div>
        <div>Source</div>
      </div>

      <ul className="divide-y divide-border">
        {unified.map((row) => {
          const isInat = row.key.startsWith("inat-");
          const hidden = row.hiddenKey ? isHidden(row.hiddenKey) : false;
          return (
            <li
              key={row.key}
              className="relative group md:grid md:grid-cols-[80px_2fr_140px_1.5fr_140px] md:gap-4 md:items-center px-4 py-3 hover:bg-muted/30 transition-colors"
              data-testid={`row-record-${row.key}`}
            >
              {/* Photo */}
              <div className="float-left mr-3 md:float-none md:mr-0 mb-2 md:mb-0">
                {isInat ? (
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                    data-testid={`link-record-photo-${row.key}`}
                  >
                    <RecordThumb photoUrl={row.photoUrl} alt={displayCommonName} hidden={hidden} />
                  </a>
                ) : (
                  <Link href={row.href} className="block" data-testid={`link-record-photo-${row.key}`}>
                    <RecordThumb photoUrl={row.photoUrl} alt={displayCommonName} hidden={hidden} />
                  </Link>
                )}
              </div>

              {/* Location */}
              <div className="text-sm">
                <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground">Location</div>
                {row.location ? (
                  <div className="flex items-start gap-1 text-foreground/85">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                    <span className="line-clamp-2">{row.location}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>

              {/* Date */}
              <div className="text-sm mt-1.5 md:mt-0">
                <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground">Date</div>
                {row.date ? (
                  <div className="flex items-center gap-1 text-foreground/85">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatDateAu(row.date)}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>

              {/* Observer + top identifier */}
              <div className="text-sm mt-1.5 md:mt-0 min-w-0">
                <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground">Observer</div>
                <div className="text-foreground/85 line-clamp-2">{row.observer}</div>
                {row.topIdentifier && (
                  <div
                    className="text-[11px] text-muted-foreground mt-0.5 truncate"
                    data-testid={`text-top-identifier-${row.key}`}
                  >
                    Identified by{" "}
                    <a
                      href={row.topIdentifier.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {row.topIdentifier.name}
                    </a>
                  </div>
                )}
                {row.licenseLabel && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">{row.licenseLabel}</div>
                )}
              </div>

              {/* Source */}
              <div className="text-sm mt-1.5 md:mt-0">
                <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground">Source</div>
                {isInat ? (
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    data-testid={`link-record-source-${row.key}`}
                  >
                    {row.sourceLabel} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <Link
                    href={row.sourceUrl}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    data-testid={`link-record-source-${row.key}`}
                  >
                    {row.sourceLabel}
                  </Link>
                )}
              </div>

              {/* Clear float for mobile */}
              <div className="clear-both md:hidden" />

              {/* Admin hide/unhide — iNat rows only */}
              {isAdminPlus && row.hiddenKey && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (hidden) {
                      unhidePhoto.mutate(row.hiddenKey!);
                    } else {
                      hidePhoto.mutate(row.hiddenKey!);
                    }
                  }}
                  className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-background/90 backdrop-blur border border-border text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-background"
                  data-testid={`button-toggle-hide-photo-${row.key}`}
                  disabled={hidePhoto.isPending || unhidePhoto.isPending}
                >
                  {hidden ? (
                    <>
                      <Eye className="h-3 w-3" /> Unhide
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3 w-3" /> Hide
                    </>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecordThumb({
  photoUrl,
  alt,
  hidden,
}: {
  photoUrl: string | null;
  alt: string;
  hidden: boolean;
}) {
  if (!photoUrl) {
    return (
      <div className="w-20 h-20 rounded-md border border-border bg-muted grid place-items-center">
        <ImageOff className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="w-20 h-20 rounded-md border border-border bg-muted overflow-hidden relative">
      <img
        src={photoUrl}
        alt={alt}
        loading="lazy"
        className={`w-full h-full object-cover ${hidden ? "opacity-40" : ""}`}
      />
      {hidden && (
        <div className="absolute inset-0 grid place-items-center bg-background/40">
          <span className="px-1.5 py-0.5 rounded bg-background/90 text-[10px] font-medium border border-border">
            Hidden
          </span>
        </div>
      )}
    </div>
  );
}

function SpeciesNotesTab({ speciesId }: { speciesId: number }) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["/api/species", speciesId, "notes"],
    queryFn: () => apiNotesForSpecies(speciesId).then((r) => r.notes),
  });
  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const notes = q.data ?? [];
  return (
    <div className="space-y-4 max-w-lg">
      {user && (
        <div className="flex justify-end">
          <Link
            href={`/notes/new?speciesId=${speciesId}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            data-testid="link-write-note-species"
          >
            Write an observation note
          </Link>
        </div>
      )}
      {notes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No observation notes for this species yet. Share a behavioural or scientific note to be first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── Scientific Articles tab ─────────
function ScientificArticlesTab({ speciesId }: { speciesId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const isMod =
    !!user && ["moderator", "editor", "admin", "super-admin"].includes(user.role ?? "none");

  const articlesQ = useQuery({
    queryKey: ["/api/species", speciesId, "articles"],
    queryFn: () => apiListSpeciesArticles(speciesId),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDeleteSpeciesArticle(id),
    onSuccess: () => {
      toast({ title: "Article removed" });
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesId, "articles"],
      });
      setDeleteId(null);
    },
    onError: (err: any) => {
      toast({
        title: "Could not remove",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
      setDeleteId(null);
    },
  });

  const articles = articlesQ.data?.articles ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Scientific articles</h2>
          <p className="text-sm text-muted-foreground">
            Peer-reviewed literature, field guides, and primary sources for this
            species. Contributions welcome from any signed-in user.
          </p>
        </div>
        {user ? (
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="button-upload-article"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Submit article
          </Button>
        ) : null}
      </div>

      {articlesQ.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No scientific articles submitted yet.
          </p>
          {user ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
              className="mt-4"
            >
              Be the first to contribute
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              Sign in to submit one.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map((a) => (
            <ArticleCard
              key={a.id}
              article={a}
              canDelete={
                isMod || (!!user && a.uploader?.id === user.id)
              }
              pendingDelete={deleteId === a.id}
              onAskDelete={() => setDeleteId(a.id)}
              onCancelDelete={() => setDeleteId(null)}
              onConfirmDelete={() => deleteMut.mutate(a.id)}
              deleting={deleteMut.isPending && deleteId === a.id}
            />
          ))}
        </div>
      )}

      <UploadArticleDialog
        open={open}
        onOpenChange={setOpen}
        speciesId={speciesId}
      />
    </div>
  );
}

function ArticleCard({
  article,
  canDelete,
  pendingDelete,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  deleting,
}: {
  article: SpeciesArticleRow;
  canDelete: boolean;
  pendingDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  deleting: boolean;
}) {
  const uploadDate = new Date(article.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="rounded-md border border-border p-4 space-y-2"
      data-testid={`article-card-${article.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-snug">
            {article.title}
          </h3>
          {article.description ? (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
              {article.description}
            </p>
          ) : null}
        </div>
        {canDelete ? (
          pendingDelete ? (
            <span className="inline-flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="destructive"
                onClick={onConfirmDelete}
                disabled={deleting}
                data-testid={`button-article-confirm-delete-${article.id}`}
              >
                {deleting ? "Removing…" : "Confirm"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelDelete}
                disabled={deleting}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={onAskDelete}
              title="Remove article"
              data-testid={`button-article-delete-${article.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )
        ) : null}
      </div>

      <div className="text-sm">
        <span className="font-medium text-muted-foreground">Citation: </span>
        <span className="italic">{article.citation}</span>
      </div>
      <div className="text-sm">
        <span className="font-medium text-muted-foreground">Credit: </span>
        {article.credit}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
        {article.hasFile ? (
          <a
            href={`${(import.meta as any).env?.VITE_API_BASE || ""}/api/articles/${article.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
            data-testid={`link-article-download-${article.id}`}
          >
            <Download className="h-4 w-4" />
            {article.fileName || "Download PDF"}
          </a>
        ) : null}
        {article.externalUrl ? (
          <a
            href={article.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-primary hover:underline truncate max-w-full"
            data-testid={`link-article-external-${article.id}`}
          >
            <LinkIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {article.externalUrl.replace(/^https?:\/\//, "")}
            </span>
          </a>
        ) : null}
        <span className="text-xs text-muted-foreground ml-auto">
          {article.uploader ? (
            <>
              Submitted by{" "}
              <Link
                href={`/users/${article.uploader.username}`}
                className="hover:underline"
              >
                @{article.uploader.username}
              </Link>{" "}
              ·{" "}
            </>
          ) : null}
          {uploadDate}
        </span>
      </div>
    </div>
  );
}

function UploadArticleDialog({
  open,
  onOpenChange,
  speciesId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  speciesId: number;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [citation, setCitation] = useState("");
  const [credit, setCredit] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setCitation("");
    setCredit("");
    setExternalUrl("");
    setFileDataUrl(null);
    setFileName(null);
  };

  const createMut = useMutation({
    mutationFn: () =>
      apiCreateSpeciesArticle(speciesId, {
        title: title.trim(),
        description: description.trim() || null,
        citation: citation.trim(),
        credit: credit.trim(),
        fileDataUrl,
        fileName,
        externalUrl: externalUrl.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: "Article submitted" });
      queryClient.invalidateQueries({
        queryKey: ["/api/species", speciesId, "articles"],
      });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Could not submit",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const handleFile = (file: File) => {
    if (file.type !== "application/pdf") {
      toast({
        title: "PDF only",
        description: "Please attach a PDF file.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "PDF must be 10 MB or smaller.",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFileDataUrl(typeof reader.result === "string" ? reader.result : null);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!citation.trim()) {
      toast({ title: "Citation is required", variant: "destructive" });
      return;
    }
    if (!credit.trim()) {
      toast({ title: "Credit is required", variant: "destructive" });
      return;
    }
    if (!fileDataUrl && !externalUrl.trim()) {
      toast({
        title: "Provide a PDF or a link",
        description: "Attach a PDF file or paste a DOI / journal URL.",
        variant: "destructive",
      });
      return;
    }
    createMut.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-upload-article"
      >
        <DialogHeader>
          <DialogTitle>Submit a scientific article</DialogTitle>
          <DialogDescription>
            Attach a PDF or link to a journal article, monograph, or field
            guide. Title, citation, and credit are required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
              Title<span className="text-red-500">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. A revision of the genus Acrochordus…"
              data-testid="input-article-title"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of what the article covers"
              rows={3}
              data-testid="input-article-description"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">
              Citation<span className="text-red-500">*</span>
            </label>
            <Textarea
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
              placeholder="Smith, J. (2023). Title. Journal of Herpetology, 57(2), 123–145. https://doi.org/10.xxxx/yyyy"
              rows={2}
              data-testid="input-article-citation"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">
              Credit / attribution<span className="text-red-500">*</span>
            </label>
            <Input
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
              placeholder="Author(s), publisher, or who provided the material"
              data-testid="input-article-credit"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
            <div>
              <label className="text-sm font-medium block mb-1">
                PDF file
              </label>
              <div className="rounded-md border border-dashed border-border p-3">
                {fileDataUrl ? (
                  <div className="text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">{fileName}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        setFileDataUrl(null);
                        setFileName(null);
                      }}
                    >
                      Remove file
                    </Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 cursor-pointer text-sm text-muted-foreground py-3">
                    <Upload className="h-5 w-5" />
                    <span>Click to attach PDF (max 10 MB)</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      data-testid="input-article-file"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">
                Link / DOI
              </label>
              <Input
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://… or 10.xxxx/yyyy"
                data-testid="input-article-url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional if you attached a PDF.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createMut.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMut.isPending}
            data-testid="button-article-submit"
          >
            {createMut.isPending ? "Submitting…" : "Submit article"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
