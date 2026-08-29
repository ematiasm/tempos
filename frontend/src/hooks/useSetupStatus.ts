import { useQuery } from "@tanstack/react-query"

import { SetupService } from "@/client"

/**
 * First-run setup status. Shared between the layout guard (beforeLoad) and
 * the /setup wizard so both read the same React Query cache entry.
 */
export const setupStatusQueryOptions = () => ({
  queryKey: ["setup-status"] as const,
  queryFn: () => SetupService.readSetupStatus(),
  // Fail fast: the navigation guard must not stall on retries, and the
  // wizard submit surfaces transient errors to the user anyway.
  retry: false,
  staleTime: 30_000,
})

export function useSetupStatus() {
  return useQuery(setupStatusQueryOptions())
}
