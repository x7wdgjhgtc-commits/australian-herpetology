import exifr from "exifr";

export interface ExifExtract {
  cameraMake?: string | null;
  cameraModel?: string | null;
  lens?: string | null;
  iso?: number | null;
  fNumber?: string | null;
  shutter?: string | null;
  focalLength?: string | null;
  observedOn?: string | null;
  lat?: string | null;
  lng?: string | null;
  raw?: any;
}

function formatShutter(t: number): string {
  if (!t || !isFinite(t)) return "";
  if (t >= 1) return `${t.toFixed(1)}s`;
  const denom = Math.round(1 / t);
  return `1/${denom}s`;
}

function formatFNumber(f: number): string {
  if (!f || !isFinite(f)) return "";
  return `f/${f.toFixed(1).replace(/\.0$/, "")}`;
}

function formatFocal(mm: number): string {
  if (!mm || !isFinite(mm)) return "";
  return `${Math.round(mm)}mm`;
}

function formatDate(d: Date): string {
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function extractExif(file: File): Promise<ExifExtract> {
  try {
    const tags = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      pick: [
        "Make",
        "Model",
        "LensModel",
        "Lens",
        "ISO",
        "ISOSpeedRatings",
        "FNumber",
        "ApertureValue",
        "ExposureTime",
        "FocalLength",
        "DateTimeOriginal",
        "CreateDate",
        "GPSLatitude",
        "GPSLongitude",
        "latitude",
        "longitude",
      ],
    });
    if (!tags) return {};
    const iso = tags.ISO ?? tags.ISOSpeedRatings ?? null;
    const date: Date | undefined = tags.DateTimeOriginal ?? tags.CreateDate;
    const lat = tags.latitude ?? tags.GPSLatitude;
    const lng = tags.longitude ?? tags.GPSLongitude;
    return {
      cameraMake: tags.Make ? String(tags.Make).trim() : null,
      cameraModel: tags.Model ? String(tags.Model).trim() : null,
      lens: tags.LensModel || tags.Lens || null,
      iso: typeof iso === "number" ? iso : null,
      fNumber: tags.FNumber ? formatFNumber(tags.FNumber) : null,
      shutter: tags.ExposureTime ? formatShutter(tags.ExposureTime) : null,
      focalLength: tags.FocalLength ? formatFocal(tags.FocalLength) : null,
      observedOn: date instanceof Date ? formatDate(date) : null,
      lat: typeof lat === "number" ? String(lat) : null,
      lng: typeof lng === "number" ? String(lng) : null,
      raw: tags,
    };
  } catch (err) {
    console.warn("EXIF parse failed", err);
    return {};
  }
}

/**
 * Reverse-geocode a lat/lng via OpenStreetMap Nominatim. Returns a short
 * human-friendly label like "Coomera, Queensland, AU" or null if the lookup
 * fails. Safe to call from anywhere — errors are swallowed.
 */
export async function reverseGeocode(
  lat: number | string,
  lng: number | string,
): Promise<string | null> {
  const la = typeof lat === "string" ? parseFloat(lat) : lat;
  const ln = typeof lng === "string" ? parseFloat(lng) : lng;
  if (!isFinite(la) || !isFinite(ln)) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${ln}&zoom=14&accept-language=en-AU`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data: {
      display_name?: string;
      address?: Record<string, string>;
    } = await res.json();
    const a = data.address || {};
    const locality =
      a.suburb || a.town || a.village || a.hamlet || a.city || a.locality;
    const region = a.state || a.region || a.county;
    const country = a.country_code === "au" ? "AU" : a.country;
    const short =
      [locality, region, country].filter(Boolean).join(", ") ||
      data.display_name ||
      "";
    return short || null;
  } catch {
    return null;
  }
}

/**
 * Read a File as a base64 data URL, resizing if necessary so the longest side
 * is ≤ maxDim pixels. Keeps JPEG with quality 0.85 for size savings.
 */
export async function fileToResizedDataUrl(
  file: File,
  maxDim = 1400,
  quality = 0.85,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Image load failed"));
      im.src = url;
    });
    const longest = Math.max(img.width, img.height);
    const scale = longest > maxDim ? maxDim / longest : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
