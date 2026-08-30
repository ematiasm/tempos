import { Pencil, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { PaymentMethodPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"
import {
  buildMethodIndex,
  capCashRows,
  computeFavorApplied,
  computeSplitMetrics,
  round2,
  type SplitRowInput,
} from "./paymentMath"

/**
 * How the gap between the rows and the target is treated.
 * - `counter` is the POS flow: the rows must cover the target and any cash
 *   excess comes back as change (vuelto), never posted.
 * - `document` is document entry: the rows may under-cover — the remainder
 *   stays pending on the counterpart's account — and a cash excess stays on
 *   account as credit.
 */
export type SplitPaymentMode = "counter" | "document"

/** Whose account absorbs the pending or excess amount (wording only). */
export type SplitPaymentParty = "customer" | "supplier"

/** The composition the operator settled inside the dialog. */
export interface SplitPaymentResult {
  rows: SplitRowInput[]
  /** Credit in favor consumed against the target (0 when not used). */
  favorApplied: number
  /** Change handed back in the counter flow; always 0 in document mode. */
  vuelto: number
}

interface SplitPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  methods: PaymentMethodPublic[]
  total: number
  /** Positive when the counterpart has credit in favor (negative saldo). */
  creditInFavor: number
  mode: SplitPaymentMode
  party: SplitPaymentParty
  /** Rows to start from; defaults to one row covering the whole target. */
  initialRows?: SplitRowInput[]
  /** Favor to start from; defaults to the whole credit in favor when there is one. */
  initialFavorApplied?: number
  pending: boolean
  onConfirm: (result: SplitPaymentResult) => void
}

function useSplitCopy(party: SplitPaymentParty) {
  const t = useT()
  const { numberFormat } = useLocale()
  return {
    t,
    numberFormat,
    format: (n: number) => money(n, numberFormat),
    debt: (amount: number) =>
      party === "supplier"
        ? t("payments.split.debtSupplier", {
            amount: money(amount, numberFormat),
          })
        : t("payments.split.debtCustomer", {
            amount: money(amount, numberFormat),
          }),
    credit: (amount: number) =>
      party === "supplier"
        ? t("payments.split.creditOurs", {
            amount: money(amount, numberFormat),
          })
        : t("payments.split.creditCustomer", {
            amount: money(amount, numberFormat),
          }),
  }
}

/**
 * Composes N method×amount rows against `target = total - favorApplied`.
 *
 * In `counter` mode confirmation posts the EFFECTIVE (capped) rows: cash rows
 * are capped in reverse entry order so the posted sum equals the target
 * exactly and the vuelto never reaches the backend — it is returned for display
 * only. In `document` mode the rows are posted as entered.
 */
export function SplitPaymentDialog({
  open,
  onOpenChange,
  methods,
  total,
  creditInFavor,
  mode,
  party,
  initialRows,
  initialFavorApplied,
  pending,
  onConfirm,
}: SplitPaymentDialogProps) {
  const {
    t,
    numberFormat,
    debt: debtCopy,
    credit: creditCopy,
  } = useSplitCopy(party)

  const [rows, setRows] = useState<SplitRowInput[]>([])
  const [useCredit, setUseCredit] = useState(false)

  const methodIndex = useMemo(() => buildMethodIndex(methods), [methods])
  const defaultMethodId =
    methods.find((m) => m.marks_paid !== false)?.id ?? methods[0]?.id ?? null

  useEffect(() => {
    if (!open) return
    const favor =
      initialFavorApplied ??
      (creditInFavor > 0 ? round2(Math.min(creditInFavor, total)) : 0)
    const target = round2(Math.max(total - favor, 0))
    // Prefill the first row with the full remaining total (favor-aware) so the
    // operator only edits amounts when splitting across methods.
    setRows(
      initialRows
        ? initialRows.map((row) => ({ ...row }))
        : defaultMethodId
          ? [{ methodId: defaultMethodId, amount: target }]
          : [],
    )
    setUseCredit(favor > 0)
  }, [
    open,
    defaultMethodId,
    creditInFavor,
    total,
    initialRows,
    initialFavorApplied,
  ])

  const favorApplied = computeFavorApplied(creditInFavor, useCredit, total)
  const metrics = computeSplitMetrics(rows, methodIndex, total, favorApplied)
  const counter = mode === "counter"
  const debt = counter ? 0 : round2(Math.max(metrics.remaining, 0))
  const onAccount = counter ? 0 : metrics.overpaid

  const updateRow = (index: number, patch: Partial<SplitRowInput>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }
  const addRow = () => {
    if (!defaultMethodId) return
    // New rows start with whatever is still uncovered (never negative) so
    // the operator only types when splitting.
    setRows((prev) => [
      ...prev,
      { methodId: defaultMethodId, amount: Math.max(metrics.remaining, 0) },
    ])
  }
  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  const feedback = metrics.nonCashOverpaid
    ? t("errors.payment_exceeds_total")
    : metrics.creditExceeded
      ? t("errors.credit_exceeds_total")
      : counter && metrics.uncovered
        ? t("payments.split.uncovered", {
            amount: money(metrics.remaining, numberFormat),
          })
        : null

  const canConfirm =
    !pending &&
    !metrics.nonCashOverpaid &&
    !metrics.creditExceeded &&
    // A counter sale must be fully covered; a document may leave a balance.
    (!counter || (!metrics.uncovered && rows.length > 0))

  const confirm = () => {
    const effective = counter
      ? capCashRows(rows, methodIndex, metrics.target)
      : rows
    onConfirm({
      rows: effective,
      favorApplied,
      vuelto: counter ? metrics.vuelto : 0,
    })
  }

  const coveredShown = round2(
    Math.min(metrics.paidSum + metrics.creditSum, metrics.target),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="split-dialog">
        <DialogHeader>
          <DialogTitle>{t("payments.split.title")}</DialogTitle>
          <DialogDescription>
            {t("sell.total")}: {money(total, numberFormat)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={row.methodId}
                onValueChange={(v) => updateRow(index, { methodId: v })}
              >
                <SelectTrigger
                  className="flex-1"
                  data-testid={`split-row-${index}-method`}
                >
                  <SelectValue placeholder={t("payments.split.method")} />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="w-28 text-right"
                aria-label={t("payments.split.amount")}
                data-testid={`split-row-${index}-amount`}
                value={row.amount}
                onChange={(e) =>
                  updateRow(index, { amount: Number(e.target.value) || 0 })
                }
              />
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t("common.delete")}
                  data-testid={`split-row-${index}-remove`}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="split-add-row"
            onClick={addRow}
          >
            {t("payments.split.addRow")}
          </Button>
        </div>

        {creditInFavor > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useCredit}
              onChange={(e) => setUseCredit(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t("sell.useCredit", {
              credit: money(creditInFavor, numberFormat),
            })}
          </label>
        )}

        <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("payments.split.coveredLabel")}
            </span>
            <span data-testid="split-covered">
              {t("payments.split.covered", {
                amount: money(coveredShown, numberFormat),
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("payments.split.remainingLabel")}
            </span>
            <span data-testid="split-remaining">
              {t("payments.split.remaining", {
                amount: money(Math.max(metrics.remaining, 0), numberFormat),
              })}
            </span>
          </div>
          {counter && metrics.vuelto > 0 && !metrics.nonCashOverpaid && (
            <div className="flex justify-between text-emerald-600">
              <span>{t("sell.changeDue", { change: "" }).trimEnd()}</span>
              <span data-testid="split-vuelto">
                {t("sell.changeDue", {
                  change: money(metrics.vuelto, numberFormat),
                })}
              </span>
            </div>
          )}
          {debt > 0 && (
            <p className="text-xs text-amber-600" data-testid="split-debt">
              {debtCopy(debt)}
            </p>
          )}
          {onAccount > 0 &&
            !metrics.nonCashOverpaid &&
            !metrics.creditExceeded && (
              <p
                className="text-xs text-emerald-600"
                data-testid="split-on-account"
              >
                {creditCopy(onAccount)}
              </p>
            )}
          {feedback && (
            <p
              className="text-xs text-destructive"
              role="alert"
              data-testid="split-feedback"
            >
              {feedback}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <LoadingButton
            type="button"
            data-testid="split-confirm"
            loading={pending}
            disabled={!canConfirm}
            onClick={confirm}
          >
            {debt > 0
              ? t("payments.split.confirmDebt", {
                  amount: money(debt, numberFormat),
                })
              : t("payments.split.confirm")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SplitPaymentSummaryProps {
  rows: SplitRowInput[]
  methods: PaymentMethodPublic[]
  total: number
  favorApplied: number
  party: SplitPaymentParty
  onEdit: () => void
  onClear: () => void
}

/**
 * Read-only recap of a composed payment set, shown in place of the single
 * method/amount fields on document entry surfaces.
 */
export function SplitPaymentSummary({
  rows,
  methods,
  total,
  favorApplied,
  party,
  onEdit,
  onClear,
}: SplitPaymentSummaryProps) {
  const { t, format, debt: debtCopy, credit: creditCopy } = useSplitCopy(party)
  const methodIndex = useMemo(() => buildMethodIndex(methods), [methods])
  const metrics = computeSplitMetrics(rows, methodIndex, total, favorApplied)
  const debt = round2(Math.max(metrics.remaining, 0))
  const onAccount = metrics.overpaid
  const nameOf = (id: string) => methods.find((m) => m.id === id)?.name ?? id

  return (
    <div
      className="flex flex-col gap-1 rounded-md border p-2 text-xs"
      data-testid="split-summary"
    >
      {rows.length === 0 ? (
        <span
          className="text-muted-foreground"
          data-testid="split-summary-empty"
        >
          {t("payments.split.none")}
        </span>
      ) : (
        rows.map((row, index) => (
          <div
            className="flex justify-between"
            key={`${row.methodId}-${index}`}
            data-testid={`split-summary-row-${index}`}
          >
            <span className="text-muted-foreground">
              {nameOf(row.methodId)}
            </span>
            <span>{format(row.amount)}</span>
          </div>
        ))
      )}
      {favorApplied > 0 && (
        <div className="flex justify-between text-muted-foreground">
          <span>{t("sell.creditInFavor")}</span>
          <span>-{format(favorApplied)}</span>
        </div>
      )}
      {debt > 0 && (
        <p className="text-amber-600" data-testid="split-summary-debt">
          {debtCopy(debt)}
        </p>
      )}
      {onAccount > 0 && (
        <p className="text-emerald-600" data-testid="split-summary-credit">
          {creditCopy(onAccount)}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="split-edit"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("common.edit")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="split-clear"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
          {t("payments.split.clear")}
        </Button>
      </div>
    </div>
  )
}
