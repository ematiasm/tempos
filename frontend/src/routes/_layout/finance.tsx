import { createFileRoute } from "@tanstack/react-router"
import { ArrowLeftRight, Wallet } from "lucide-react"
import { Suspense, useState } from "react"

import { AccountsCards } from "@/components/Finance/AccountsCards"
import { AddTransferDialog } from "@/components/Finance/AddTransferDialog"
import { TransferHistoryTab } from "@/components/Finance/TransferHistoryTab"
import { MovementsTab } from "@/components/Reports/MovementsTab"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useAuth from "@/hooks/useAuth"
import { formatStatic, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"

export const Route = createFileRoute("/_layout/finance")({
  component: Finance,
  head: () => ({
    meta: [{ title: `${formatStatic("nav.finance")} - tempos` }],
  }),
})

function Finance() {
  const t = useT()
  const { user } = useAuth()
  const canTransfer = hasPermission(user, "transfer.create")

  const [tab, setTab] = useState("accounts")
  const [accountId, setAccountId] = useState<string | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)

  const selectAccount = (id: string) => {
    setAccountId(id)
    setTab("movements")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("nav.finance")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("finance.subtitle")}
            </p>
          </div>
        </div>
        <Tooltip>
          {/* Disabled buttons swallow pointer events: the span keeps the
              tooltip reachable while the button stays non-interactive. */}
          <TooltipTrigger asChild>
            <span className="inline-block">
              <Button
                disabled={!canTransfer}
                onClick={() => canTransfer && setTransferOpen(true)}
              >
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                {t("finance.newTransfer")}
              </Button>
            </span>
          </TooltipTrigger>
          {!canTransfer && (
            <TooltipContent>{t("finance.noTransferPermission")}</TooltipContent>
          )}
        </Tooltip>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
              {[
                ["accounts", t("finance.tabAccounts")],
                ["movements", t("finance.tabMovements")],
                ["transfers", t("finance.tabTransfers")],
              ].map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-11 rounded-none border-b-2 border-transparent px-4 pb-2 pt-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="p-4 sm:p-6">
              <TabsContent value="accounts" className="mt-0">
                <AccountsCards
                  selectedId={accountId}
                  onSelect={selectAccount}
                />
              </TabsContent>
              <TabsContent value="movements" className="mt-0">
                <Suspense fallback={null}>
                  <MovementsTab initialAccountId={accountId ?? undefined} />
                </Suspense>
              </TabsContent>
              <TabsContent value="transfers" className="mt-0">
                <TransferHistoryTab
                  accountId={accountId}
                  onAccountIdChange={(id) => setAccountId(id ?? null)}
                />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      <AddTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onCreated={() => {}}
      />
    </div>
  )
}

export default Finance
