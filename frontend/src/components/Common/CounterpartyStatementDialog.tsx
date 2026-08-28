import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { ChevronDown, Mail, Printer } from "lucide-react"
import { type FormEvent, Fragment, useEffect, useState } from "react"

import {
  type CounterpartStatementPublic,
  type CustomerPublic,
  CustomersService,
  OpenAPI,
  type StatementDocumentPublic,
  type StatementEmailCreate,
  type SupplierPublic,
  SuppliersService,
} from "@/client"
import { money, qty } from "@/components/Reports/reportFormat"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { useLocale, useT } from "@/i18n"
import type { NumberFormat } from "@/lib/format"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

type StatementCounterpartType = "customer" | "supplier"

/** ISO date (yyyy-mm-dd) for a local date, without timezone drift. */
const toISODate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const firstDayOfMonthISO = () => {
  const now = new Date()
  return toISODate(new Date(now.getFullYear(), now.getMonth(), 1))
}

/** Plain dates (yyyy-mm-dd) are formatted as-is to avoid day drift; datetimes go through Date. */
const formatDate = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-")
    return `${day}/${month}/${year}`
  }
  return new Date(value).toLocaleDateString("es-AR")
}

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("es-AR")

function useCounterpartyStatement(
  counterpartId: string,
  type: StatementCounterpartType,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "counterpart-statement",
      type,
      counterpartId,
      dateFrom ?? null,
      dateTo ?? null,
    ],
    queryFn: () =>
      type === "customer"
        ? CustomersService.readCustomerStatement({
            customerId: counterpartId,
            dateFrom,
            dateTo,
          })
        : SuppliersService.readSupplierStatement({
            supplierId: counterpartId,
            dateFrom,
            dateTo,
          }),
    enabled,
    placeholderData: keepPreviousData,
  })
}

function StatementStat({
  label,
  value,
  numberFormat,
}: {
  label: string
  value: string
  numberFormat: NumberFormat
}) {
  return (
    <div className="rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="mt-0.5 block font-mono text-sm font-medium">
        {money(value, numberFormat)}
      </span>
    </div>
  )
}

function StatementDocumentRow({
  doc,
  expanded,
  onToggle,
  t,
  numberFormat,
}: {
  doc: StatementDocumentPublic
  expanded: boolean
  onToggle: () => void
  t: ReturnType<typeof useT>
  numberFormat: NumberFormat
}) {
  const lines = doc.lines ?? []
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/50"
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-sm">{doc.numero}</span>
          <span className="text-xs text-muted-foreground">
            {formatDate(doc.fecha)} · {doc.type_name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">
            {money(doc.total, numberFormat)}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>
      {expanded && lines.length > 0 && (
        <table className="w-full border-t text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">
                {t("counterparty.statement.product")}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">
                {t("counterparty.statement.quantity")}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">
                {t("counterparty.statement.unitPrice")}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">
                {t("common.subtotal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={`${line.product_id}-${index}`}
                className="last:border-b-0"
              >
                <td className="px-3 py-1.5">{line.product_name ?? "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {qty(line.cantidad)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {money(line.precio_unit, numberFormat)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {money(line.subtotal_line, numberFormat)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface StatementPrintOverlayProps {
  statement: CounterpartStatementPublic
  type: StatementCounterpartType
  onClose: () => void
}

/** Full-screen print preview; the existing #voucher-print print CSS isolates the statement. */
function StatementPrintOverlay({
  statement,
  type,
  onClose,
}: StatementPrintOverlayProps) {
  const t = useT()
  return (
    <div className="voucher-overlay fixed inset-0 z-50 flex flex-col bg-background">
      <style>{`@media print { @page { size: A4; margin: 12mm; } }`}</style>
      <div className="no-print flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-lg font-semibold">
          {t("counterparty.statement.printPreview")}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            {t("common.print")}
          </Button>
        </div>
      </div>
      <div className="voucher-scroll flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-8">
        <StatementPrintContent statement={statement} type={type} />
      </div>
    </div>
  )
}

function StatementPrintContent({
  statement,
  type,
}: {
  statement: CounterpartStatementPublic
  type: StatementCounterpartType
}) {
  const t = useT()
  const { numberFormat } = useLocale()
  const { settings } = useBusinessSettings()
  const isCustomer = type === "customer"
  const totals = statement.totals
  const documents = statement.documents ?? []
  const receipts = statement.receipts ?? []
  const mainTotalLabel = t(
    isCustomer
      ? "counterparty.statement.sales"
      : "counterparty.statement.purchases",
  )
  const mainTotal = isCustomer ? totals.total_ventas : totals.total_compras
  const periodText =
    statement.date_from || statement.date_to
      ? `${statement.date_from ? formatDate(statement.date_from) : "—"} — ${
          statement.date_to ? formatDate(statement.date_to) : "—"
        }`
      : t("counterparty.statement.fullHistory")

  return (
    <div
      id="voucher-print"
      className="mx-auto max-w-[800px] bg-white text-black"
    >
      <div className="border-b border-black pb-4 text-center">
        {settings?.logo_path && (
          <img
            src={`${OpenAPI.BASE}${settings.logo_path}`}
            alt={settings.business_name}
            className="mx-auto mb-2 max-h-20 object-contain"
          />
        )}
        <h1 className="text-xl font-bold uppercase tracking-wide">
          {settings?.business_name ?? t("voucher.businessName")}
        </h1>
        {settings?.cuit && <p className="text-sm">CUIT: {settings.cuit}</p>}
        {settings?.address && <p className="text-sm">{settings.address}</p>}
        {(settings?.phone || settings?.email) && (
          <p className="text-sm">
            {[settings.phone, settings.email].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-black py-4">
        <div className="text-sm">
          <p className="text-sm font-semibold uppercase tracking-wide">
            {t("counterparty.statement.title")}
          </p>
          <p>
            <span className="font-semibold">
              {t(isCustomer ? "voucher.customer" : "voucher.supplier")}:
            </span>{" "}
            {statement.razon_social}
          </p>
          {statement.documento && (
            <p>
              {t("counterparty.statement.document")}: {statement.documento}
            </p>
          )}
          <p>
            {t("counterparty.statement.taxCondition")}:{" "}
            {statement.condicion_fiscal}
          </p>
          {statement.address && (
            <p>
              {t("admin.general.address")}: {statement.address}
            </p>
          )}
          {statement.email && (
            <p>
              {t("auth.email")}: {statement.email}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
          <p>
            {t("counterparty.statement.period")}: {periodText}
          </p>
          <p>
            {t("counterparty.statement.generatedAt", {
              date: formatDateTime(statement.generated_at),
            })}
          </p>
        </div>
      </div>

      <div className="ml-auto flex w-64 flex-col gap-1 border-b border-black py-4 text-sm">
        <div className="flex justify-between">
          <span>{mainTotalLabel}</span>
          <span>{money(mainTotal, numberFormat)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t("counterparty.statement.notes")}</span>
          <span>{money(totals.total_notas, numberFormat)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t("counterparty.statement.payments")}</span>
          <span>{money(totals.total_pagos, numberFormat)}</span>
        </div>
        <div className="flex justify-between border-t border-black pt-1 text-base font-bold">
          <span>{t("counterparty.statement.currentBalance")}</span>
          <span>{money(totals.saldo_actual, numberFormat)}</span>
        </div>
      </div>

      <div className="border-b border-black py-4">
        <p className="mb-2 text-sm font-semibold">
          {t("counterparty.statement.documents")}
        </p>
        {documents.length === 0 ? (
          <p className="text-sm text-black/60">
            {t("counterparty.statement.empty")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-2 pr-2 font-semibold">
                  {t("counterparty.statement.document")}
                </th>
                <th className="py-2 pr-2 font-semibold">
                  {t("counterparty.statement.date")}
                </th>
                <th className="py-2 pr-2 font-semibold">
                  {t("counterparty.statement.type")}
                </th>
                <th className="py-2 text-right font-semibold">
                  {t("common.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <Fragment key={doc.id}>
                  <tr className="border-b border-black font-semibold">
                    <td className="py-2 pr-2 font-mono">{doc.numero}</td>
                    <td className="py-2 pr-2">{formatDate(doc.fecha)}</td>
                    <td className="py-2 pr-2">{doc.type_name}</td>
                    <td className="py-2 text-right">
                      {money(doc.total, numberFormat)}
                    </td>
                  </tr>
                  {(doc.lines ?? []).map((line, index) => (
                    <tr
                      key={`${doc.id}-${line.product_id}-${index}`}
                      className="border-b border-dotted border-black/40 text-xs"
                    >
                      <td className="py-1 pr-2 pl-5" colSpan={3}>
                        {line.product_name ?? "—"} · {qty(line.cantidad)} ×{" "}
                        {money(line.precio_unit, numberFormat)}
                      </td>
                      <td className="py-1 text-right">
                        {money(line.subtotal_line, numberFormat)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-b border-black py-4">
        <p className="mb-2 text-sm font-semibold">
          {t("counterparty.statement.receipts")}
        </p>
        {receipts.length === 0 ? (
          <p className="text-sm text-black/60">
            {t("counterparty.statement.noReceipts")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-2 pr-2 font-semibold">
                  {t("counterparty.statement.document")}
                </th>
                <th className="py-2 pr-2 font-semibold">
                  {t("counterparty.statement.date")}
                </th>
                <th className="py-2 pr-2 font-semibold">
                  {t("counterparty.statement.methods")}
                </th>
                <th className="py-2 text-right font-semibold">
                  {t("common.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr
                  key={receipt.id}
                  className="border-b border-dotted border-black/40"
                >
                  <td className="py-2 pr-2 font-mono">{receipt.numero}</td>
                  <td className="py-2 pr-2">{formatDate(receipt.fecha)}</td>
                  <td className="py-2 pr-2">
                    {(receipt.payment_method_names ?? []).join(" · ") || "—"}
                  </td>
                  <td className="py-2 text-right">
                    {money(receipt.total, numberFormat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="pt-8 text-center text-xs text-black/50">tempos</p>
    </div>
  )
}

interface CounterpartyStatementDialogProps {
  counterpart: CustomerPublic | SupplierPublic | null
  type: StatementCounterpartType
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CounterpartyStatementDialog({
  counterpart,
  type,
  open,
  onOpenChange,
}: CounterpartyStatementDialogProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [dateFrom, setDateFrom] = useState(firstDayOfMonthISO)
  const [dateTo, setDateTo] = useState(() => toISODate(new Date()))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState("")
  const [printOpen, setPrintOpen] = useState(false)

  const counterpartId = counterpart?.id ?? ""

  // A different counterpart starts over: default period, collapsed rows, no email form.
  useEffect(() => {
    setDateFrom(firstDayOfMonthISO())
    setDateTo(toISODate(new Date()))
    setExpanded(new Set())
    setEmailOpen(false)
  }, [])

  const statementQuery = useCounterpartyStatement(
    counterpartId,
    type,
    dateFrom || undefined,
    dateTo || undefined,
    open && counterpart != null,
  )
  const statement = statementQuery.data

  const isCustomer = type === "customer"
  const totals = statement?.totals
  const documents = statement?.documents ?? []
  const receipts = statement?.receipts ?? []
  const saldo = totals ? Number(totals.saldo_actual) : 0
  const mainTotalLabel = t(
    isCustomer
      ? "counterparty.statement.sales"
      : "counterparty.statement.purchases",
  )
  const mainTotal = totals
    ? isCustomer
      ? totals.total_ventas
      : totals.total_compras
    : "0"

  const emailMutation = useMutation({
    mutationFn: (address: string | undefined) => {
      const requestBody: StatementEmailCreate = address
        ? { email_to: address }
        : {}
      return type === "customer"
        ? CustomersService.emailCustomerStatement({
            customerId: counterpartId,
            requestBody,
          })
        : SuppliersService.emailSupplierStatement({
            supplierId: counterpartId,
            requestBody,
          })
    },
    onSuccess: (_data, address) => {
      showSuccessToast(
        t("counterparty.statement.emailSent", {
          email: address || statement?.email || counterpart?.email || "",
        }),
      )
      setEmailOpen(false)
    },
    onError: handleError.bind(showErrorToast),
  })

  if (!counterpart) return null

  const toggleDocument = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const openEmailForm = () => {
    setEmailTo(statement?.email ?? counterpart.email ?? "")
    setEmailOpen(true)
  }

  const handleEmailSubmit = (event: FormEvent) => {
    event.preventDefault()
    emailMutation.mutate(emailTo.trim() || undefined)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("counterparty.statement.title")}</DialogTitle>
            <DialogDescription>
              {counterpart.razon_social} ·{" "}
              {t("counterparty.statement.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="statement-from"
                className="text-xs text-muted-foreground"
              >
                {t("counterparty.statement.from")}
              </Label>
              <Input
                id="statement-from"
                type="date"
                className="h-9 w-[150px]"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="statement-to"
                className="text-xs text-muted-foreground"
              >
                {t("counterparty.statement.to")}
              </Label>
              <Input
                id="statement-to"
                type="date"
                className="h-9 w-[150px]"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              {t("counterparty.statement.fullHistoryHint")}
            </p>
          </div>

          {statementQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : statement == null || totals == null ? null : (
            <>
              <Card className="py-4">
                <CardContent className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">
                    {t("counterparty.statement.currentBalance")}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-2xl font-bold",
                      saldo > 0 && "text-destructive",
                      saldo < 0 && "text-green-600",
                    )}
                  >
                    {money(totals.saldo_actual, numberFormat)}
                  </span>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <StatementStat
                  label={mainTotalLabel}
                  value={mainTotal}
                  numberFormat={numberFormat}
                />
                <StatementStat
                  label={t("counterparty.statement.notes")}
                  value={totals.total_notas}
                  numberFormat={numberFormat}
                />
                <StatementStat
                  label={t("counterparty.statement.payments")}
                  value={totals.total_pagos}
                  numberFormat={numberFormat}
                />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {t("counterparty.statement.documents")}
                </h3>
                {documents.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t("counterparty.statement.empty")}
                  </p>
                ) : (
                  <div className="rounded-lg border">
                    {documents.map((doc) => (
                      <StatementDocumentRow
                        key={doc.id}
                        doc={doc}
                        expanded={expanded.has(doc.id)}
                        onToggle={() => toggleDocument(doc.id)}
                        t={t}
                        numberFormat={numberFormat}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {t("counterparty.statement.receipts")}
                </h3>
                {receipts.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t("counterparty.statement.noReceipts")}
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {receipts.map((receipt) => (
                      <li
                        key={receipt.id}
                        className="flex items-center justify-between gap-2 p-3"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-sm">
                            {receipt.numero}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(receipt.fecha)}
                            {(receipt.payment_method_names ?? []).length > 0 &&
                              ` · ${(receipt.payment_method_names ?? []).join(" · ")}`}
                          </span>
                        </div>
                        <span className="font-mono text-sm font-medium">
                          {money(receipt.total, numberFormat)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {emailOpen && (
            <form
              className="flex items-center gap-2"
              onSubmit={handleEmailSubmit}
            >
              <Input
                type="email"
                data-testid="statement-email-input"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                autoFocus
              />
              <Button type="submit" disabled={emailMutation.isPending}>
                {t("counterparty.statement.emailSend")}
              </Button>
            </form>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {statement?.emails_enabled && (
              <Button
                variant="outline"
                data-testid="statement-email"
                onClick={openEmailForm}
              >
                <Mail className="mr-2 h-4 w-4" />
                {t("counterparty.statement.email")}
              </Button>
            )}
            {statement && (
              <Button
                variant="outline"
                data-testid="statement-print"
                onClick={() => setPrintOpen(true)}
              >
                <Printer className="mr-2 h-4 w-4" />
                {t("common.print")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {printOpen && statement && (
        <StatementPrintOverlay
          statement={statement}
          type={type}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </>
  )
}

export default CounterpartyStatementDialog
