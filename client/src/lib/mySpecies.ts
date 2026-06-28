/**
 * Hook returning the current viewer's species ID set + per-species counts.
 * Used to render green-tick badges and "you've seen N" labels.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGetMySpecies, type UserSpeciesResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function useMySpecies() {
  const { user } = useAuth();
  const q = useQuery<UserSpeciesResponse>({
    queryKey: ["/api/me/species", user?.id ?? null],
    queryFn: apiGetMySpecies,
    // Run regardless of auth — endpoint returns empty list when logged-out.
    staleTime: 30_000,
  });
  const ids = q.data?.speciesIds ?? [];
  const idSet = new Set(ids);
  const countsBySpecies = new Map<number, number>();
  for (const c of q.data?.counts ?? []) {
    countsBySpecies.set(c.speciesId, c.count);
  }
  return {
    isLoggedIn: !!user,
    speciesIdSet: idSet,
    countsBySpecies,
    counts: q.data?.counts ?? [],
    isLoading: q.isLoading,
  };
}
