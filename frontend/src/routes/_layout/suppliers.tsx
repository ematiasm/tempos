import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { SuppliersService } from "@/client"
import { CounterpartyDetailSheet } from "@/components/Common/CounterpartyDetailSheet"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import AddSupplier from "@/components/Suppliers/AddSupplier"
import {
  getColumns,
  type SupplierTableData,
} from "@/components/Suppliers/supplierColumns"
import { Input } from "@/components/ui/input"
import { formatStatic, useT } from "@/i18n"

function getSuppliersQueryOptions() {
  return {
    queryFn: () => SuppliersService.readSuppliers({ skip: 0, limit: 1000 }),
    queryKey: ["suppliers"],
  }
}

export const Route = createFileRoute("/_layout/suppliers")({
  component: Suppliers,
  head: () => ({
    meta: [{ title: `${formatStatic("suppliers.title")} - tempos` }],
  }),
})

function SuppliersContent() {
  const t = useT()
  const { data: suppliers } = useSuspenseQuery(getSuppliersQueryOptions())
  const [search, setSearch] = useState("")
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const data = suppliers.data as SupplierTableData[]
    if (!q) return data
    return data.filter(
      (s) =>
        s.razon_social.toLowerCase().includes(q) ||
        (s.documento ?? "").toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q),
    )
  }, [suppliers.data, search])

  const openSupplier = useMemo(
    () => suppliers.data.find((s) => s.id === openSupplierId) ?? null,
    [suppliers.data, openSupplierId],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("suppliers.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <DataTable
        columns={getColumns(t, (supplier) => setOpenSupplierId(supplier.id))}
        data={rows}
      />
      <CounterpartyDetailSheet
        counterpart={openSupplier}
        type="supplier"
        open={openSupplierId !== null}
        onOpenChange={(o) => !o && setOpenSupplierId(null)}
      />
    </div>
  )
}

function Suppliers() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("suppliers.title")}
          </h1>
          <p className="text-muted-foreground">{t("suppliers.subtitle")}</p>
        </div>
        <AddSupplier />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <SuppliersContent />
      </Suspense>
    </div>
  )
}
