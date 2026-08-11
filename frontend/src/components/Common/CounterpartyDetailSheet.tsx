import { useState } from "react"
import type { CustomerPublic, SupplierPublic } from "@/client"
import {
  movementColumns,
  useAccountMovements,
  useMovementRows,
} from "@/components/Common/accountMovements"
import { CONSUMIDOR_FINAL_NAME } from "@/components/Common/conditionOptions"
import { DataTable } from "@/components/Common/DataTable"
import { ReceiptDialog } from "@/components/Payments/ReceiptDialog"
import { money } from "@/components/Reports/reportFormat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"

interface CounterpartyDetailSheetProps {
  counterpart: CustomerPublic | SupplierPublic | null
  type: "customer" | "supplier"
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm", mono && "font-mono")}>{value}</dd>
    </div>
  )
}

export function CounterpartyDetailSheet({
  counterpart,
  type,
  open,
  onOpenChange,
}: CounterpartyDetailSheetProps) {
  const t = useT()
  const { data, isLoading } = useAccountMovements(
    counterpart?.id ?? "",
    type,
    open && counterpart != null,
  )
  const rows = useMovementRows(data)
  const [receiptOpen, setReceiptOpen] = useState(false)

  if (!counterpart) return null

  const isCustomer = type === "customer"
  const creditLimit =
    isCustomer && "limite_credito" in counterpart
      ? counterpart.limite_credito
      : null
  const saldo = Number(counterpart.saldo)
  const isDefaultCustomer =
    isCustomer && counterpart.razon_social === CONSUMIDOR_FINAL_NAME

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-xl">
            {counterpart.razon_social}
            {isDefaultCustomer && (
              <Badge variant="outline" className="text-xs">
                {t("customers.default")}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {t(isCustomer ? "customers.sheetHint" : "suppliers.sheetHint")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t("counterparty.details")}</h3>
          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <DetailRow
              label={t(
                isCustomer
                  ? "customers.nameBusiness"
                  : "suppliers.businessName",
              )}
              value={counterpart.razon_social}
            />
            <DetailRow
              label={t(
                isCustomer ? "customers.document" : "suppliers.document",
              )}
              value={counterpart.documento ?? "—"}
              mono
            />
            <DetailRow
              label={t(
                isCustomer
                  ? "customers.taxCondition"
                  : "suppliers.taxCondition",
              )}
              value={counterpart.condicion_fiscal ?? "—"}
            />
            <DetailRow
              label={t(isCustomer ? "customers.phone" : "suppliers.phone")}
              value={counterpart.phone ?? "—"}
            />
            <DetailRow
              label={t("auth.email")}
              value={counterpart.email ?? "—"}
            />
            <DetailRow
              label={t(isCustomer ? "customers.address" : "suppliers.address")}
              value={counterpart.address ?? "—"}
            />
            <DetailRow
              label={t("common.status")}
              value={
                counterpart.is_active
                  ? t("common.active")
                  : t("common.inactive")
              }
            />
            {creditLimit != null && (
              <DetailRow
                label={t("customers.creditLimit")}
                value={
                  Number(creditLimit) === 0
                    ? t("customers.noLimit")
                    : money(creditLimit)
                }
              />
            )}
          </dl>
        </div>

        <Card className="mt-4 py-4">
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">
              {t("counterparty.balance")}
            </span>
            <span
              className={cn(
                "font-mono text-2xl font-bold",
                saldo > 0 && "text-destructive",
                saldo < 0 && "text-green-600",
              )}
            >
              {money(saldo)}
            </span>
            {creditLimit != null && (
              <span className="text-xs text-muted-foreground">
                {t("customers.creditLimit")}:{" "}
                {Number(creditLimit) === 0
                  ? t("customers.noLimit")
                  : money(creditLimit)}
              </span>
            )}
          </CardContent>
          {isCustomer && Number(saldo) > 0 && (
            <CardContent className="pt-0">
              <Button
                className="w-full"
                data-testid="receipt-open"
                onClick={() => setReceiptOpen(true)}
              >
                {t("payments.receiveCustomer")}
              </Button>
            </CardContent>
          )}
          {!isCustomer && Number(saldo) > 0 && (
            <CardContent className="pt-0">
              <Button
                className="w-full"
                data-testid="receipt-open"
                onClick={() => setReceiptOpen(true)}
              >
                {t("payments.paySupplier")}
              </Button>
            </CardContent>
          )}
        </Card>

        <div className="mt-4">
          <h3 className="text-sm font-semibold">
            {t("counterparty.movements")}
          </h3>
          {isLoading ? (
            <Skeleton className="mt-2 h-64 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("currentAccount.empty")}
            </p>
          ) : (
            <div className="mt-2">
              <DataTable columns={movementColumns(t)} data={rows} />
            </div>
          )}
        </div>

        <ReceiptDialog
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
          counterpartType={type}
          counterpartId={counterpart.id}
          onCreated={() => {}}
        />
      </SheetContent>
    </Sheet>
  )
}
