import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"

import { CustomersService, SuppliersService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { money } from "@/components/Reports/reportFormat"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface AccountRow {
  id: string
  type: "customer" | "supplier"
  razon_social: string
  saldo: string
  limite_credito?: string
  is_active: boolean
}

export function CurrentAccountsTab() {
  const t = useT()
  const { numberFormat } = useLocale()
  const { user } = useAuth()
  // The tab reads from the customers / suppliers endpoints (customer.read /
  // supplier.read) inside the reports panel, so each query is gated on the
  // panel permission plus its endpoint permission: an unauthorized visitor
  // gets empty states instead of 403 toasts.
  const canView = hasPermission(user, "report.view")
  const canReadCustomers = canView && hasPermission(user, "customer.read")
  const canReadSuppliers = canView && hasPermission(user, "supplier.read")
  const { data: customers, isLoading: loadingCustomers } = useQuery({
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 500 }),
    queryKey: ["customers"],
    enabled: canReadCustomers,
  })
  const { data: suppliers, isLoading: loadingSuppliers } = useQuery({
    queryFn: () => SuppliersService.readSuppliers({ skip: 0, limit: 500 }),
    queryKey: ["suppliers"],
    enabled: canReadSuppliers,
  })

  const rows: AccountRow[] = [
    ...(customers?.data ?? []).map((c) => ({
      id: c.id,
      type: "customer" as const,
      razon_social: c.razon_social,
      saldo: c.saldo,
      limite_credito: c.limite_credito,
      is_active: c.is_active ?? true,
    })),
    ...(suppliers?.data ?? []).map((s) => ({
      id: s.id,
      type: "supplier" as const,
      razon_social: s.razon_social,
      saldo: s.saldo,
      is_active: s.is_active ?? true,
    })),
  ]

  const columns: ColumnDef<AccountRow>[] = [
    {
      accessorKey: "type",
      header: t("reports.type"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.type}</Badge>,
    },
    { accessorKey: "razon_social", header: t("reports.name") },
    {
      accessorKey: "saldo",
      header: t("reports.balance"),
      cell: ({ row }) => {
        const value = Number(row.original.saldo)
        return (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "font-medium",
                value > 0
                  ? "text-emerald-600"
                  : value < 0
                    ? "text-red-600"
                    : "",
              )}
            >
              {money(row.original.saldo, numberFormat)}
            </span>
            {row.original.type === "customer" ? (
              value > 0 ? (
                <Badge variant="outline">{t("reports.owesUs")}</Badge>
              ) : value < 0 ? (
                <Badge variant="secondary">{t("reports.creditInFavor")}</Badge>
              ) : null
            ) : value < 0 ? (
              <Badge variant="outline">{t("reports.owesUs")}</Badge>
            ) : value > 0 ? (
              <Badge variant="secondary">{t("reports.weOwe")}</Badge>
            ) : null}
          </span>
        )
      },
    },
    {
      accessorKey: "acepta",
      header: t("reports.allowance"),
      cell: ({ row }) =>
        row.original.type === "customer"
          ? money(row.original.limite_credito, numberFormat)
          : "—",
    },
    {
      accessorKey: "is_active",
      header: t("reports.status"),
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge variant="outline">{t("common.active")}</Badge>
        ) : (
          <Badge variant="secondary">{t("common.inactive")}</Badge>
        ),
    },
  ]

  const customersOwing = (customers?.data ?? []).filter(
    (c) => Number(c.saldo) > 0,
  ).length
  const suppliersOwing = (suppliers?.data ?? []).filter(
    (s) => Number(s.saldo) < 0,
  ).length

  const isLoading = loadingCustomers || loadingSuppliers

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>
          {customers?.data.length ?? 0} customers · {customersOwing} with
          balance
        </span>
        <span>
          {suppliers?.data.length ?? 0} suppliers · {suppliersOwing} with
          balance
        </span>
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DataTable columns={columns} data={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
