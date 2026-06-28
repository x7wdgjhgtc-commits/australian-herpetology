import { Link } from "wouter";
import { MapPin, HelpCircle, Images, Lock } from "lucide-react";
import type { AppRecord } from "@/lib/api";
import { AdminBadge } from "@/components/AdminBadge";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RecordCard({
  record,
  showAuthor = true,
  variant = "grid",
}: {
  record: AppRecord;
  showAuthor?: boolean;
  variant?: "grid" | "list";
}) {
  const isUnknown = !record.speciesName;

  if (variant === "list") {
    return (
      <Link
        href={`/r/${record.id}`}
        className="flex items-stretch gap-3 rounded-md overflow-hidden bg-card border border-border hover-elevate"
        data-testid={`card-record-${record.id}`}
      >
        <div className="w-28 sm:w-36 shrink-0 bg-muted relative">
          <img
            src={(record.photos && record.photos[0]) || record.photoDataUrl}
            alt={record.speciesName || "Unknown species"}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          {record.photos && record.photos.length > 1 && (
            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] bg-background/80 backdrop-blur flex items-center gap-0.5">
              <Images className="h-3 w-3" />
              {record.photos.length}
            </div>
          )}
          {record.obscured && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] bg-background/80 backdrop-blur flex items-center gap-0.5">
              <Lock className="h-3 w-3" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 py-3 pr-3 flex flex-col justify-between">
          <div className="min-w-0">
            {isUnknown ? (
              <div className="flex items-center gap-1.5 font-medium text-sm">
                <HelpCircle className="h-3.5 w-3.5" /> Needs ID
              </div>
            ) : (
              <>
                <div
                  className="font-medium text-sm truncate"
                  data-testid={`text-record-common-${record.id}`}
                >
                  {record.speciesCommon || record.speciesName}
                </div>
                {record.speciesCommon && (
                  <div className="text-xs italic text-muted-foreground truncate">
                    {record.speciesName}
                  </div>
                )}
              </>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
              {record.placeGuess && (
                <span className="flex items-center gap-1 min-w-0 truncate">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[180px]">
                    {record.placeGuess}
                  </span>
                </span>
              )}
              <span className="shrink-0">
                {formatDate(
                  record.observedOn
                    ? new Date(record.observedOn).getTime()
                    : record.createdAt,
                )}
              </span>
            </div>
          </div>
          {showAuthor && record.author && (
            <div className="mt-2 flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
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
              <div className="text-xs text-foreground/80 truncate flex items-center gap-1">
                <span className="truncate">{record.author.displayName || record.author.username}</span>
                <AdminBadge user={record.author} variant="compact" />
              </div>
            </div>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/r/${record.id}`}
      className="block rounded-md overflow-hidden bg-card border border-border hover-elevate"
      data-testid={`card-record-${record.id}`}
    >
      <div className="aspect-square bg-muted relative">
        <img
          src={(record.photos && record.photos[0]) || record.photoDataUrl}
          alt={record.speciesName || "Unknown species"}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        {isUnknown && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[11px] bg-background/80 backdrop-blur flex items-center gap-1">
            <HelpCircle className="h-3 w-3" />
            Needs ID
          </div>
        )}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {record.obscured && (
            <div
              className="px-1.5 py-0.5 rounded text-[10px] bg-background/80 backdrop-blur flex items-center gap-0.5"
              title="Location obscured"
              data-testid={`badge-obscured-${record.id}`}
            >
              <Lock className="h-3 w-3" />
            </div>
          )}
          {record.photos && record.photos.length > 1 && (
            <div
              className="px-1.5 py-0.5 rounded text-[10px] bg-background/80 backdrop-blur flex items-center gap-0.5"
              data-testid={`badge-photo-count-${record.id}`}
            >
              <Images className="h-3 w-3" />
              {record.photos.length}
            </div>
          )}
        </div>
      </div>
      <div className="p-3">
        {isUnknown ? (
          <div className="font-medium text-sm text-muted-foreground">Unknown species</div>
        ) : (
          <>
            <div className="font-medium text-sm truncate" data-testid={`text-record-common-${record.id}`}>
              {record.speciesCommon || record.speciesName}
            </div>
            {record.speciesCommon && (
              <div className="text-xs italic text-muted-foreground truncate">
                {record.speciesName}
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-muted-foreground">
          {record.placeGuess ? (
            <span className="flex items-center gap-1 min-w-0 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{record.placeGuess}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="shrink-0">{formatDate(record.observedOn ? new Date(record.observedOn).getTime() : record.createdAt)}</span>
        </div>
        {showAuthor && record.author && (
          <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
              {record.author.avatarDataUrl && (
                <img
                  src={record.author.avatarDataUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  style={{ objectPosition: (record.author as any).avatarPos || "50% 50%" }}
                />
              )}
            </div>
            <div className="text-xs text-foreground/80 truncate flex items-center gap-1">
              <span className="truncate">{record.author.displayName || record.author.username}</span>
              <AdminBadge user={record.author} variant="compact" />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
