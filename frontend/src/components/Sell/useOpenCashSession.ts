import { useQuery } from "@tanstack/react-query"

import { CashSessionsService } from "@/client"
import useAuth from "@/hooks/useAuth"
import { hasPermission } from "@/lib/permissions"

/**
 * The currently open cash session (or null), shared by the cash register bar
 * and the sell-screen payment gate. React Query key: ["cash-sessions",
 * "current"] — namespaced under the "cash-sessions" prefix so the open/close
 * dialogs' prefix invalidation (`["cash-sessions"]`) also refreshes this
 * query. Gated by the `cash.read` permission: users without it see the
 * register as closed (no query, no 403 toast).
 */
export function useOpenCashSession() {
  const { user } = useAuth()
  const canRead = hasPermission(user, "cash.read")
  const { data, isLoading } = useQuery({
    queryFn: () => CashSessionsService.readCurrentCashSession(),
    queryKey: ["cash-sessions", "current"],
    enabled: canRead,
  })
  const session = data ?? null
  const isOpen = session != null && session.status === "open"
  return { session, isOpen, isLoading }
}
