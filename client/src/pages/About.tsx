import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Map as MapIcon, BookOpen, Camera } from "lucide-react";
import { fetchSpecies, biggerPhoto, type SpeciesListResponse } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { useMySpecies } from "@/lib/mySpecies";
import { SeenBadge } from "@/components/SeenBadge";

export default function About() {
  const mySpecies = useMySpecies();
  const { data, isLoading } = useQuery<SpeciesListResponse>({
    queryKey: ["/api/species", "", "all", 1, 8],
    queryFn: () => fetchSpecies("", "all", 1, 8),
  });

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-20 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7">
            <div className="text-xs uppercase tracking-[0.18em] text-primary font-medium mb-4">
              Field guide · Australia
            </div>
            <h1
              className="font-serif text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] mb-6"
              data-testid="text-hero-title"
            >
              Every reptile and amphibian on the continent, in one field guide.
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mb-8 leading-relaxed">
              Built on open biodiversity data from the Atlas of Living Australia and iNaturalist. Browse 1,200+ species, study distribution maps, and find out what lives in any patch of bush you choose.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/browse"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-primary-foreground font-medium hover-elevate active-elevate-2"
                data-testid="button-browse-species"
              >
                <BookOpen className="h-4 w-4" /> Browse species
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-border bg-card font-medium hover-elevate"
                data-testid="button-map-search"
              >
                <MapIcon className="h-4 w-4" /> Search by location
              </Link>
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="aspect-[4/5] rounded-lg border border-border overflow-hidden bg-muted relative">
              {isLoading || !data?.results?.[0]?.taxon?.default_photo ? (
                <Skeleton className="w-full h-full" />
              ) : (
                <>
                  <img
                    src={
                      biggerPhoto(
                        data.results[0].taxon.default_photo.medium_url,
                        "large",
                      ) || ""
                    }
                    alt={
                      data.results[0].taxon.preferred_common_name ||
                      data.results[0].taxon.name
                    }
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white">
                    <div className="text-xs uppercase tracking-widest opacity-80 mb-1">
                      Featured
                    </div>
                    <div className="font-serif text-2xl font-semibold">
                      {data.results[0].taxon.preferred_common_name ||
                        data.results[0].taxon.name}
                    </div>
                    <div className="italic text-sm opacity-80">
                      {data.results[0].taxon.name}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* What you can do */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
          What's inside
        </div>
        <h2 className="font-serif text-3xl font-semibold tracking-tight mb-8">
          Three ways to use the guide
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              icon: BookOpen,
              title: "Browse species",
              body: "Search the full list of Australian reptiles and amphibians. Filter by group, jump to any species profile.",
              href: "/browse",
              cta: "Open species list",
            },
            {
              icon: MapIcon,
              title: "Map search",
              body: "Pin a location on the map. We'll list every reptile and amphibian recorded within that radius, drawn from ALA.",
              href: "/map",
              cta: "Open map search",
            },
            {
              icon: Camera,
              title: "Photo-rich profiles",
              body: "Each species page includes habitat, diet, distribution map, and recent observations with proper photo credits.",
              href: "/browse",
              cta: "See an example",
            },
          ].map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="border border-border rounded-lg p-6 bg-card hover-elevate flex flex-col"
              data-testid={`card-feature-${card.title.toLowerCase().replace(/\s/g, "-")}`}
            >
              <card.icon className="h-6 w-6 text-primary mb-4" />
              <div className="font-serif text-xl font-semibold mb-2">
                {card.title}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                {card.body}
              </p>
              <div className="mt-4 text-sm font-medium text-primary flex items-center gap-1">
                {card.cta} <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured species grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 border-t border-border">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Most observed
            </div>
            <h2 className="font-serif text-3xl font-semibold tracking-tight">
              Familiar faces
            </h2>
          </div>
          <Link
            href="/browse"
            className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
            data-testid="link-see-all"
          >
            See all species <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))
            : (data?.results || []).slice(0, 8).map((r) => {
                const myCount =
                  mySpecies.countsBySpecies.get(r.taxon.id) ?? 0;
                return (
                  <Link
                    key={r.taxon.id}
                    href={`/species/${r.taxon.id}`}
                    className="group block"
                    data-testid={`card-species-${r.taxon.id}`}
                  >
                    <div className="aspect-square rounded-lg overflow-hidden border border-border bg-muted relative">
                      {myCount > 0 && (
                        <div className="absolute top-2 right-2 z-10">
                          <SeenBadge count={myCount} variant="dot" />
                        </div>
                      )}
                      {r.taxon.default_photo?.medium_url ? (
                        <img
                          src={r.taxon.default_photo.medium_url}
                          alt={
                            r.taxon.preferred_common_name || r.taxon.name
                          }
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="mt-2 px-1">
                      <div
                        className="font-medium text-sm leading-tight truncate"
                        data-testid={`text-species-common-${r.taxon.id}`}
                      >
                        {r.taxon.preferred_common_name || r.taxon.name}
                      </div>
                      <div className="text-xs italic text-muted-foreground truncate">
                        {r.taxon.name}
                      </div>
                    </div>
                  </Link>
                );
              })}
        </div>
      </section>

      {/* About the guide */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-14 border-t border-border">
        <h2 className="font-serif text-3xl font-semibold tracking-tight mb-6">
          About this guide
        </h2>
        <div className="prose-styles space-y-5 font-serif text-lg leading-relaxed text-foreground/85">
          <p>
            Australian Herpetology is a free, open-data field guide to every reptile and amphibian recorded on the continent — from the saltwater crocodile to the smallest skink, from the great barred frog to the cane toad.
          </p>
          <p>
            Species records, common names, and distribution data are pulled live from the{" "}
            <a
              className="underline text-primary"
              href="https://www.ala.org.au/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Atlas of Living Australia
            </a>{" "}
            — Australia's national biodiversity database — and{" "}
            <a
              className="underline text-primary"
              href="https://www.inaturalist.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              iNaturalist
            </a>
            , the global citizen-science platform run by the California Academy of Sciences and the National Geographic Society.
          </p>
          <p>
            Every photograph shown here is the work of an individual naturalist who chose to share it under a Creative Commons license. The photographer's name, the license terms, and the location the photo was taken are shown next to every image. If you'd like to use a photo elsewhere, click through to the iNaturalist observation and follow the license requirements.
          </p>
        </div>

        <h3 className="font-serif text-2xl font-semibold tracking-tight mt-12 mb-4">
          Data quality
        </h3>
        <ul className="space-y-2 text-foreground/85 leading-relaxed list-disc pl-6">
          <li>
            Distribution maps show only research-grade observations — meaning two or more independent identifiers have agreed on the species.
          </li>
          <li>
            The map-search feature uses ALA's{" "}
            <code className="font-mono text-sm">geospatial_kosher</code> filter to exclude records with known location issues.
          </li>
          <li>
            Species descriptions and habitat/diet notes are excerpts from the linked Wikipedia article. Where information is missing, the field is omitted rather than fabricated.
          </li>
        </ul>

        <h3 className="font-serif text-2xl font-semibold tracking-tight mt-12 mb-4">
          Limitations
        </h3>
        <p className="text-foreground/85 leading-relaxed">
          This is a community-data project, not an identification key. Always cross-check any field identification with a printed guide or an expert before assuming a species is safe to handle. Some Australian elapids look very similar to one another and a misidentification can be life-threatening.
        </p>

        <h3 className="font-serif text-2xl font-semibold tracking-tight mt-12 mb-4">
          Install as an app
        </h3>
        <p className="text-foreground/85 leading-relaxed">
          Australian Herpetology is a Progressive Web App. On a phone or tablet, open your browser's share menu and tap "Add to Home Screen" to install it like a native app. It will appear with its own icon and run full-screen.
        </p>
      </section>

      {/* Data credit */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t border-border">
        <div className="bg-card border border-card-border rounded-lg p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-start">
          <div className="flex-1">
            <div className="font-serif text-xl font-semibold mb-2">
              Open data, properly credited
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Photos shown on this guide come from naturalists around the country who shared their work under Creative Commons licenses on{" "}
              <a
                className="underline hover:text-primary"
                href="https://www.inaturalist.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                iNaturalist
              </a>
              . Distribution and area-search records come from the{" "}
              <a
                className="underline hover:text-primary"
                href="https://www.ala.org.au/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Atlas of Living Australia
              </a>
              . Every photo is shown with its photographer, license, and where it was taken.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
