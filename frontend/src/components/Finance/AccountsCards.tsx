import { useQuery } from "@tanstack/react-query"
import { Wallet } from "lucide-react"
import { FinancialAccountsService } from "@/client"
import { money } from "@/components/Reports/reportFormat"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface AccountsCardsProps {
  selectedId?: string | null
  onSelect: (accountId: string) => void
}

export function AccountsCards({ selectedId, onSelect }: AccountsCardsProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  // GET /financial-accounts requires finance.read; without it the query does
  // not fire and the panel renders its empty state (no 403 toast).
  const canRead = hasPermission(user, "finance.read")

  const { data, isLoading } = useQuery({
    queryFn: () =>
      FinancialAccountsService.readFinancialAccounts({ skip: 0, limit: 100 }),
    queryKey: ["financial-accounts"],
    enabled: canRead,
  })

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  const accounts = data?.data ?? []

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((account) => {
        const selected = account.id === selectedId
        return (
          <button
            key={account.id}
            type="button"
            onClick={() => onSelect(account.id)}
            className={cn(
              "text-left transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "ring-2 ring-primary",
            )}
          >
            <Card
              className={cn(
                "h-full transition-colors hover:bg-accent/50",
                selected && "bg-accent/60",
              )}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-full bg-muted p-2.5">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{account.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {account.currency}
                  </p>
                  <p className="font-mono text-sm font-semibold">
                    {money(account.saldo, numberFormat)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </button>
        )
      })}
      {accounts.length === 0 && (
        <p className="col-span-full text-sm text-muted-foreground">
          {t("finance.noAccounts")}
        </p>
      )}
    </div>
  )
}
