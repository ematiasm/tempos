import { useQuery } from "@tanstack/react-query"

import { CashSessionsService } from "@/client"

/**
 * The currently open cash session (or null), shared by the cash register bar
 * and the sell-screen payment gate. React Query key: ["cash-sessions-current"].
 */
export function useOpenCashSession() {
  const { data, isLoading } = useQuery({
    queryFn: () => CashSessionsService.readCurrentCashSession(),
    queryKey: ["cash-sessions-current"],
  })
  const session = data ?? null
  const isOpen = session != null && session.status === "open"
  return { session, isOpen, isLoading }
}
