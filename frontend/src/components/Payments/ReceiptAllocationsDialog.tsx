import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PaymentsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { money } from "@/components/Reports/reportFormat"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"

interface ReceiptAllocationsDialogProps {
  receiptId: string | null
  numero: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReceiptAllocationsDialog({
  receiptId,
  numero,
  open,
  onOpenChange,
}: ReceiptAllocationsDialogProps) {
  const t = useT()
  const { data, isLoading } = useQuery({
    queryFn: () =>
      PaymentsService.readReceiptAllocations({
        receiptDocumentId: receiptId!,
      }),
    queryKey: ["payments-allocations", receiptId],
    enabled: open && receiptId != null,
  })

  const rows = useMemo(() => {
    const allocations = data ?? []
    if (allocations.length === 0) return []
    return allocations.map((a, i) => ({
      id: `${a.document_id}-${i}`,
      numero: a.numero,
      fecha: a.fecha ?? null,
      monto: Number(a.monto),
    }))
  }, [data])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("payments.allocationsTitle", { numero })}
          </DialogTitle>
          <DialogDescription>{t("payments.allocationsHint")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("payments.allocationsEmpty")}
          </p>
        ) : (
          <DataTable
            columns={[
              {
                accessorKey: "numero",
                header: t("currentAccount.document"),
                cell: ({ row }) => (
                  <span className="font-mono text-xs">
                    {row.original.numero}
                  </span>
                ),
              },
              {
                accessorKey: "fecha",
                header: t("currentAccount.date"),
                cell: ({ row }) =>
                  row.original.fecha ? row.original.fecha.slice(0, 10) : "—",
              },
              {
                accessorKey: "monto",
                header: t("currentAccount.amount"),
                cell: ({ row }) => (
                  <span className="font-mono">{money(row.original.monto)}</span>
                ),
              },
            ]}
            data={rows}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
