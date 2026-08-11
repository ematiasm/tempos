import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

import {
  type CustomerAccountMovementPublic,
  CustomersService,
  type SupplierAccountMovementPublic,
  SuppliersService,
} from "@/client"
import { money } from "@/components/Reports/reportFormat"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"

export type AccountMovementType = "customer" | "supplier"

export type AccountMovement =
  | CustomerAccountMovementPublic
  | SupplierAccountMovementPublic

export interface MovementRow {
  id: string
  fecha: string | null
  documento: string | null
  monto: number
  saldo: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function useAccountMovements(
  counterpartId: string,
  type: AccountMovementType,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["account-movements", type, counterpartId],
    queryFn: async () => {
      const page =
        type === "customer"
          ? await CustomersService.readCustomerAccountMovements({
              customerId: counterpartId,
              skip: 0,
              limit: 500,
            })
          : await SuppliersService.readSupplierAccountMovements({
              supplierId: counterpartId,
              skip: 0,
              limit: 500,
            })
      return page.data as AccountMovement[]
    },
    enabled,
  })
}

export function useMovementRows(
  movements: AccountMovement[] | undefined,
): MovementRow[] {
  return useMemo(() => {
    const oldestFirst = [...(movements ?? [])].sort((a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    )
    let acc = 0
    return oldestFirst
      .map((m) => {
        acc = round2(acc + Number(m.monto))
        return {
          id: m.id,
          fecha: m.created_at ?? null,
          documento: m.document_numero ?? null,
          monto: Number(m.monto),
          saldo: acc,
        }
      })
      .reverse()
  }, [movements])
}

export function movementColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<MovementRow>[] {
  return [
    {
      accessorKey: "fecha",
      header: t("currentAccount.date"),
      cell: ({ row }) =>
        row.original.fecha
          ? new Date(row.original.fecha).toLocaleString("es-AR")
          : "—",
    },
    {
      accessorKey: "documento",
      header: t("currentAccount.document"),
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.documento ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "monto",
      header: t("currentAccount.amount"),
      cell: ({ row }) => (
        <span
          className={cn(
            "font-mono text-sm",
            row.original.monto > 0
              ? "text-red-600"
              : row.original.monto < 0
                ? "text-green-600"
                : "",
          )}
        >
          {money(row.original.monto)}
        </span>
      ),
    },
    {
      accessorKey: "saldo",
      header: t("currentAccount.balance"),
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">
          {money(row.original.saldo)}
        </span>
      ),
    },
  ]
}
