import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Camera,
  MapPin,
  Calendar as CalendarIcon,
  Upload,
  Loader2,
  X,
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Eye,
  EyeOff,
  Copyright,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  apiCreateRecord,
  LICENSE_OPTIONS,
  CONDITION_OPTIONS,
  BEHAVIOUR_OPTIONS,
  type LicenseCode,
  type ConditionTag,
} from "@/lib/api";
import { extractExif, fileToResizedDataUrl, reverseGeocode } from "@/lib/photo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpeciesPicker, type PickedSpecies } from "@/components/SpeciesPicker";
import LocationPicker from "@/components/LocationPicker";
import { queryClient } from "@/lib/queryClient";

const MAX_PHOTOS = 10;

export default function NewRecord() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [picked, setPicked] = useState<PickedSpecies | null>(null);
  // Photos: arrays kept in lockstep (preview blob URLs + base64 data URLs).
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [processingPhoto, setProcessingPhoto] = useState(false);

  // form fields
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [placeGuess, setPlaceGuess] = useState("");
  const [observedOn, setObservedOn] = useState("");
  const [cameraMake, setCameraMake] = useState("");
  const [cameraModel, setCameraModel] = useState("");
  const [lens, setLens] = useState("");
  const [iso, setIso] = useState("");
  const [fNumber, setFNumber] = useState("");
  const [shutter, setShutter] = useState("");
  const [focalLength, setFocalLength] = useState("");
  const [exifJson, setExifJson] = useState<string | null>(null);

  // New: privacy / license / condition / behaviour
  // Default ON — protects sensitive locality data (especially for rare/threatened
  // species). User can toggle off explicitly per record.
  const [obscureLocation, setObscureLocation] = useState(true);
  const [licenseCode, setLicenseCode] = useState<LicenseCode>("all-rights-reserved");
  const [conditionTag, setConditionTag] = useState<ConditionTag | "">("");
  const [behaviors, setBehaviors] = useState<string[]>([]);

  useEffect(() => {
    if (!user) setLocation("/login");
  }, [user, setLocation]);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      previewUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      if (photos.length === 0) throw new Error("Add at least one photo first");
      return apiCreateRecord({
        photoDataUrl: photos[0],
        photos,
        speciesId: picked?.taxonId ?? null,
        parentSpeciesId: picked?.parentSpeciesId ?? null,
        speciesName: picked?.scientificName ?? null,
        speciesCommon: picked?.commonName ?? null,
        groupKey: picked?.groupKey ?? null,
        familyId: picked?.familyId ?? null,
        familyName: picked?.familyName ?? null,
        genus: picked?.genus ?? null,
        notes: notes || null,
        lat: lat || null,
        lng: lng || null,
        placeGuess: placeGuess || null,
        observedOn: observedOn || null,
        cameraMake: cameraMake || null,
        cameraModel: cameraModel || null,
        lens: lens || null,
        iso: iso ? parseInt(iso, 10) : null,
        fNumber: fNumber || null,
        shutter: shutter || null,
        focalLength: focalLength || null,
        exifJson,
        obscureLocation,
        licenseCode,
        conditionTag: conditionTag || null,
        behaviors,
      });
    },
    onSuccess: ({ record }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      if (user) {
        queryClient.invalidateQueries({
          queryKey: ["/api/users", user.username, "records"],
        });
      }
      toast({ title: "Record created" });
      setLocation(`/r/${record.id}`);
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save record",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  async function onFilesAdded(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast({
        title: `Photo limit reached`,
        description: `You can attach up to ${MAX_PHOTOS} photos per record.`,
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    setProcessingPhoto(true);
    try {
      const isFirstUpload = photos.length === 0;
      const newPreviews: string[] = [];
      const newPhotos: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        newPreviews.push(URL.createObjectURL(file));

        // Auto-fill EXIF from the FIRST photo of the FIRST upload only
        const shouldAutoFill = isFirstUpload && i === 0;
        if (shouldAutoFill) {
          const [exif, dataUrl] = await Promise.all([
            extractExif(file),
            fileToResizedDataUrl(file, 1400, 0.85),
          ]);
          newPhotos.push(dataUrl);
          if (exif.cameraMake && !cameraMake) setCameraMake(exif.cameraMake);
          if (exif.cameraModel && !cameraModel) setCameraModel(exif.cameraModel);
          if (exif.lens && !lens) setLens(exif.lens);
          if (exif.iso != null && !iso) setIso(String(exif.iso));
          if (exif.fNumber && !fNumber) setFNumber(exif.fNumber);
          if (exif.shutter && !shutter) setShutter(exif.shutter);
          if (exif.focalLength && !focalLength) setFocalLength(exif.focalLength);
          if (exif.observedOn && !observedOn) setObservedOn(exif.observedOn);
          if (exif.lat && !lat) setLat(exif.lat);
          if (exif.lng && !lng) setLng(exif.lng);
          if (exif.raw) setExifJson(JSON.stringify(exif.raw));
          // If the photo had GPS but we don't yet have a place label, reverse-geocode it.
          if (exif.lat && exif.lng && !placeGuess.trim()) {
            reverseGeocode(exif.lat, exif.lng)
              .then((label) => {
                if (label) setPlaceGuess((cur) => (cur.trim() ? cur : label));
              })
              .catch(() => {});
          }
        } else {
          const dataUrl = await fileToResizedDataUrl(file, 1400, 0.85);
          newPhotos.push(dataUrl);
        }
      }

      setPreviewUrls((prev) => [...prev, ...newPreviews]);
      setPhotos((prev) => [...prev, ...newPhotos]);
    } catch (err: any) {
      toast({
        title: "Could not read photo",
        description: err?.message || "",
        variant: "destructive",
      });
    } finally {
      setProcessingPhoto(false);
      e.target.value = "";
    }
  }

  function removePhoto(index: number) {
    setPreviewUrls((prev) => {
      const url = prev[index];
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
      return prev.filter((_, i) => i !== index);
    });
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function movePhoto(index: number, dir: -1 | 1) {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= photos.length) return;
    const swap = <T,>(arr: T[]): T[] => {
      const copy = arr.slice();
      [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
      return copy;
    };
    setPreviewUrls((prev) => swap(prev));
    setPhotos((prev) => swap(prev));
  }

  function toggleBehavior(value: string) {
    setBehaviors((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (photos.length === 0) {
      toast({
        title: "Photo required",
        description: "Please add at least one photo of your sighting.",
        variant: "destructive",
      });
      return;
    }
    create.mutate();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-serif text-xl font-semibold mb-1">New record</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Photograph what you found. Camera and location info will be filled from EXIF if available.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Photos */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label>Photos</Label>
            <span className="text-xs text-muted-foreground" data-testid="text-photo-count">
              {photos.length}/{MAX_PHOTOS}
            </span>
          </div>

          {photos.length === 0 ? (
            <div className="relative aspect-[4/3] rounded-md border-2 border-dashed border-border bg-card flex items-center justify-center overflow-hidden">
              <div className="text-center text-muted-foreground px-4">
                <Camera className="h-8 w-8 mx-auto mb-2" />
                <div className="text-sm">Tap to add photos</div>
                <div className="text-xs mt-1">Up to {MAX_PHOTOS}. First photo is the cover.</div>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onFilesAdded}
                className="absolute inset-0 opacity-0 cursor-pointer"
                data-testid="input-photo"
              />
              {processingPhoto && (
                <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {previewUrls.map((url, i) => (
                  <div
                    key={url}
                    className="relative aspect-square rounded-md overflow-hidden border border-border bg-card group"
                    data-testid={`photo-tile-${i}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {i === 0 && (
                      <div className="absolute top-1 left-1 bg-background/85 text-foreground text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded">
                        Cover
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/85 hover:bg-background flex items-center justify-center text-foreground"
                      aria-label="Remove photo"
                      data-testid={`button-remove-photo-${i}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => movePhoto(i, -1)}
                        disabled={i === 0}
                        className="flex-1 h-6 rounded bg-background/85 hover:bg-background disabled:opacity-40 flex items-center justify-center"
                        aria-label="Move left"
                        data-testid={`button-move-left-${i}`}
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePhoto(i, 1)}
                        disabled={i === previewUrls.length - 1}
                        className="flex-1 h-6 rounded bg-background/85 hover:bg-background disabled:opacity-40 flex items-center justify-center"
                        aria-label="Move right"
                        data-testid={`button-move-right-${i}`}
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                  <label
                    className="relative aspect-square rounded-md border-2 border-dashed border-border bg-card hover:bg-accent/40 flex flex-col items-center justify-center text-muted-foreground cursor-pointer"
                    data-testid="button-add-more-photos"
                  >
                    {processingPhoto ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <ImagePlus className="h-5 w-5 mb-1" />
                        <span className="text-[11px]">Add more</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={onFilesAdded}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      disabled={processingPhoto}
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                First photo is the cover. Hover or focus a tile to reorder.
              </p>
            </>
          )}
        </div>

        {/* Species */}
        <div className="space-y-2">
          <Label>Species</Label>
          <SpeciesPicker value={picked} onChange={setPicked} />
        </div>

        {/* Observation conditions */}
        <fieldset className="space-y-3 rounded-md border border-border bg-card p-4">
          <legend className="px-2 text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" />
            Observation
          </legend>

          <div>
            <Label htmlFor="condition">Conditions</Label>
            <Select
              value={conditionTag || undefined}
              onValueChange={(v) => setConditionTag(v as ConditionTag)}
            >
              <SelectTrigger id="condition" data-testid="select-condition">
                <SelectValue placeholder="How was it observed?" />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-condition-${opt.value}`}>
                    <span className="mr-2">{opt.icon}</span>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Behaviour</Label>
            <div className="flex flex-wrap gap-1.5">
              {BEHAVIOUR_OPTIONS.map((b) => {
                const active = behaviors.includes(b.value);
                return (
                  <button
                    type="button"
                    key={b.value}
                    onClick={() => toggleBehavior(b.value)}
                    className={
                      "px-2.5 py-1 rounded-full text-xs border transition-colors " +
                      (active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-accent")
                    }
                    aria-pressed={active}
                    data-testid={`chip-behavior-${b.value}`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Habitat, weather, other field notes…"
            rows={3}
            data-testid="input-notes"
          />
        </div>

        {/* Location */}
        <fieldset className="space-y-3 rounded-md border border-border bg-card p-4">
          <legend className="px-2 text-sm font-medium flex items-center gap-1.5">
            <MapPin className="h-4 w-4" />
            Location
          </legend>
          {/* Interactive map picker */}
          <LocationPicker
            lat={lat}
            lng={lng}
            onChange={({ lat: nLat, lng: nLng, placeGuess: nPlace }) => {
              setLat(nLat);
              setLng(nLng);
              // Only auto-fill the place name when reverse-geocode succeeds AND
              // the user hasn't already typed something custom.
              if (nPlace && !placeGuess.trim()) setPlaceGuess(nPlace);
            }}
          />
          <div>
            <Label htmlFor="placeGuess">Place</Label>
            <Input
              id="placeGuess"
              value={placeGuess}
              onChange={(e) => setPlaceGuess(e.target.value)}
              placeholder="e.g., Mt Tamborine, QLD"
              data-testid="input-place"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lat">Latitude</Label>
              <Input id="lat" value={lat} onChange={(e) => setLat(e.target.value)} data-testid="input-lat" />
            </div>
            <div>
              <Label htmlFor="lng">Longitude</Label>
              <Input id="lng" value={lng} onChange={(e) => setLng(e.target.value)} data-testid="input-lng" />
            </div>
          </div>
          <div>
            <Label htmlFor="observedOn" className="flex items-center gap-1.5">
              <CalendarIcon className="h-4 w-4" />
              Date observed
            </Label>
            <Input
              id="observedOn"
              type="date"
              value={observedOn}
              onChange={(e) => setObservedOn(e.target.value)}
              data-testid="input-date"
            />
          </div>

          {/* Obscure toggle */}
          <div className="flex items-start justify-between gap-3 pt-2 border-t border-border">
            <div className="space-y-0.5">
              <Label htmlFor="obscure" className="flex items-center gap-1.5">
                {obscureLocation ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Obscure location
              </Label>
              <p className="text-xs text-muted-foreground">
                Public viewers see a fuzzed point within ~10 km. You always see the exact spot.
              </p>
            </div>
            <Switch
              id="obscure"
              checked={obscureLocation}
              onCheckedChange={setObscureLocation}
              data-testid="switch-obscure"
            />
          </div>
        </fieldset>

        {/* Copyright */}
        <fieldset className="space-y-3 rounded-md border border-border bg-card p-4">
          <legend className="px-2 text-sm font-medium flex items-center gap-1.5">
            <Copyright className="h-4 w-4" />
            Copyright
          </legend>
          <div>
            <Label htmlFor="license">Photo license</Label>
            <Select value={licenseCode} onValueChange={(v) => setLicenseCode(v as LicenseCode)}>
              <SelectTrigger id="license" data-testid="select-license">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-license-${opt.value}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1.5">
              Choose how others can reuse your photos. You retain ownership in all cases.
            </p>
          </div>
        </fieldset>

        {/* Camera */}
        <fieldset className="space-y-3 rounded-md border border-border bg-card p-4">
          <legend className="px-2 text-sm font-medium flex items-center gap-1.5">
            <Camera className="h-4 w-4" />
            Camera
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="make">Make</Label>
              <Input id="make" value={cameraMake} onChange={(e) => setCameraMake(e.target.value)} data-testid="input-make" />
            </div>
            <div>
              <Label htmlFor="model">Model</Label>
              <Input id="model" value={cameraModel} onChange={(e) => setCameraModel(e.target.value)} data-testid="input-model" />
            </div>
          </div>
          <div>
            <Label htmlFor="lens">Lens</Label>
            <Input id="lens" value={lens} onChange={(e) => setLens(e.target.value)} data-testid="input-lens" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="iso">ISO</Label>
              <Input id="iso" inputMode="numeric" value={iso} onChange={(e) => setIso(e.target.value)} data-testid="input-iso" />
            </div>
            <div>
              <Label htmlFor="fNumber">Aperture</Label>
              <Input id="fNumber" value={fNumber} onChange={(e) => setFNumber(e.target.value)} placeholder="f/2.8" data-testid="input-fnumber" />
            </div>
            <div>
              <Label htmlFor="shutter">Shutter</Label>
              <Input id="shutter" value={shutter} onChange={(e) => setShutter(e.target.value)} placeholder="1/200s" data-testid="input-shutter" />
            </div>
            <div>
              <Label htmlFor="focal">Focal length</Label>
              <Input id="focal" value={focalLength} onChange={(e) => setFocalLength(e.target.value)} placeholder="100mm" data-testid="input-focal" />
            </div>
          </div>
        </fieldset>

        <Button type="submit" disabled={create.isPending || processingPhoto} className="w-full" data-testid="button-save-record">
          {create.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" /> Save record
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
