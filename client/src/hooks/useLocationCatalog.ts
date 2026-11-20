import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/session";
import {
  fetchLocationCatalog,
  LOCATION_CATALOG_URL,
  readCachedLocationCatalog,
  setLocationCatalog,
} from "@/lib/locations";

export function useLocationCatalog() {
  return useQuery<Location[]>({
    queryKey: [LOCATION_CATALOG_URL],
    queryFn: async () => {
      const list = await fetchLocationCatalog();
      setLocationCatalog(list);
      return list;
    },
    initialData: () => {
      const cached = readCachedLocationCatalog();
      return cached.length > 0 ? cached : undefined;
    },
    staleTime: 5 * 60 * 1000,
  });
}
