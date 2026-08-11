import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { CustomersService } from "@/client"
import { CounterpartyDetailSheet } from "@/components/Common/CounterpartyDetailSheet"
import { DataTable } from "@/components/Common/DataTable"
import AddCustomer from "@/components/Customers/AddCustomer"
import {
  type CustomerTableData,
  getColumns,
} from "@/components/Customers/customerColumns"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Input } from "@/components/ui/input"
import { formatStatic, useT } from "@/i18n"

function getCustomersQueryOptions() {
  return {
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 1000 }),
    queryKey: ["customers"],
  }
}

export const Route = createFileRoute("/_layout/customers")({
  component: Customers,
  head: () => ({
    meta: [{ title: `${formatStatic("customers.title")} - tempos` }],
  }),
})

function CustomersContent() {
  const t = useT()
  const { data: customers } = useSuspenseQuery(getCustomersQueryOptions())
  const [search, setSearch] = useState("")
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const data = customers.data as CustomerTableData[]
    if (!q) return data
    return data.filter(
      (c) =>
        c.razon_social.toLowerCase().includes(q) ||
        (c.documento ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    )
  }, [customers.data, search])

  const openCustomer = useMemo(
    () => customers.data.find((c) => c.id === openCustomerId) ?? null,
    [customers.data, openCustomerId],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("customers.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <DataTable
        columns={getColumns(t, (customer) => setOpenCustomerId(customer.id))}
        data={rows}
      />
      <CounterpartyDetailSheet
        counterpart={openCustomer}
        type="customer"
        open={openCustomerId !== null}
        onOpenChange={(o) => !o && setOpenCustomerId(null)}
      />
    </div>
  )
}

function Customers() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("customers.title")}
          </h1>
          <p className="text-muted-foreground">{t("customers.subtitle")}</p>
        </div>
        <AddCustomer />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <CustomersContent />
      </Suspense>
    </div>
  )
}
