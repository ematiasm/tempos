import { useQuery } from "@tanstack/react-query"

import { BusinessSettingsService } from "@/client"

/** Business settings (identity + defaults), React Query key: ["business-settings"]. */
export function useBusinessSettings() {
  const { data, isLoading } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
  })
  return { settings: data ?? null, isLoading }
}
