import { createFileRoute } from "@tanstack/react-router"
import { BarChart3 } from "lucide-react"

import { CurrentAccountsTab } from "@/components/Reports/CurrentAccountsTab"
import { LowStockTab } from "@/components/Reports/LowStockTab"
import { MarginTab } from "@/components/Reports/MarginTab"
import { MovementsTab } from "@/components/Reports/MovementsTab"
import { ReorderTab } from "@/components/Reports/ReorderTab"
import { SalesPerDayTab } from "@/components/Reports/SalesPerDayTab"
import { VatTab } from "@/components/Reports/VatTab"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/i18n"

export const Route = createFileRoute("/_layout/reports")({
  component: Reports,
  head: () => ({
    meta: [{ title: "Reports - tempos" }],
  }),
})

function Reports() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.reports")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("reports.subtitle")}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="sales" className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
              {[
                ["sales", t("reports.tabDaily")],
                ["margin", t("reports.tabMargin")],
                ["vat", t("reports.tabTaxes")],
                ["stock", t("reports.tabLowStock")],
                ["reorder", t("reports.tabReorder")],
                ["movements", t("reports.tabMovements")],
                ["balances", t("reports.tabBalances")],
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
              <TabsContent value="sales">
                <SalesPerDayTab />
              </TabsContent>
              <TabsContent value="margin">
                <MarginTab />
              </TabsContent>
              <TabsContent value="vat">
                <VatTab />
              </TabsContent>
              <TabsContent value="stock">
                <LowStockTab />
              </TabsContent>
              <TabsContent value="reorder">
                <ReorderTab />
              </TabsContent>
              <TabsContent value="movements">
                <MovementsTab />
              </TabsContent>
              <TabsContent value="balances">
                <CurrentAccountsTab />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

export default Reports
