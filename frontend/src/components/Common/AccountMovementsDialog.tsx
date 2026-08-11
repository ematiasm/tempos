import { ReceiptText } from "lucide-react"
import { useState } from "react"

import type { CustomerPublic, SupplierPublic } from "@/client"
import {
  movementColumns,
  useAccountMovements,
  useMovementRows,
} from "@/components/Common/accountMovements"
import { DataTable } from "@/components/Common/DataTable"
import { money } from "@/components/Reports/reportFormat"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"

interface AccountMovementsDialogProps {
  counterpart: CustomerPublic | SupplierPublic
  type: "customer" | "supplier"
  onClose: () => void
}

export function AccountMovementsDialog({
  counterpart,
  type,
  onClose,
}: AccountMovementsDialogProps) {
  const t = useT()
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useAccountMovements(counterpart.id, type, open)
  const rows = useMovementRows(data)

  const creditLimit =
    type === "customer" && "limite_credito" in counterpart
      ? counterpart.limite_credito
      : null

  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
      >
        <ReceiptText />
        {t("currentAccount.title")}
      </DropdownMenuItem>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) onClose()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("currentAccount.title")}</DialogTitle>
            <DialogDescription>
              {counterpart.razon_social} · {t("currentAccount.balance")}:{" "}
              {money(counterpart.saldo)}
              {creditLimit != null && (
                <>
                  {" "}
                  · {t("currentAccount.creditLimit")}: {money(creditLimit)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("currentAccount.empty")}
            </p>
          ) : (
            <DataTable columns={movementColumns(t)} data={rows} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
