import { Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { DocumentPaymentCreate, PaymentMethodPublic } from "@/client"
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
  capCashRows,
  computeFavorApplied,
  computeSplitMetrics,
  round2,
  type SplitRowInput,
} from "./paymentMath"

interface SplitPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  methods: PaymentMethodPublic[]
  total: number
  /** Positive when the selected customer has credit in favor (saldo < 0). */
  creditInFavor: number
  pending: boolean
  onConfirm: (payments: DocumentPaymentCreate[], vuelto: number) => void
}

/**
 * Composes N method×amount rows against `target = total - favorApplied`.
 * Confirmation posts the EFFECTIVE (capped) rows: cash rows are capped in
 * reverse entry order so the posted sum equals the target exactly and the
 * vuelto never reaches the backend — it is returned for display only.
 */
export function SplitPaymentDialog({
  open,
  onOpenChange,
  methods,
  total,
  creditInFavor,
  pending,
  onConfirm,
}: SplitPaymentDialogProps) {
  const t = useT()
  const { numberFormat } = useLocale()

  const [rows, setRows] = useState<SplitRowInput[]>([])
  const [useCredit, setUseCredit] = useState(false)

  const methodIndex = useMemo(
    () =>
      new Map(
        methods.map((m) => [
          m.id,
          { marks_paid: m.marks_paid, is_cash_drawer: m.is_cash_drawer },
        ]),
      ),
    [methods],
  )
  const defaultMethodId =
    methods.find((m) => m.marks_paid !== false)?.id ?? methods[0]?.id ?? null

  useEffect(() => {
    if (!open) return
    // Prefill the first row with the full remaining total (favor-aware) so
    // the operator only edits amounts when splitting across methods.
    const initialFavor = computeFavorApplied(
      creditInFavor,
      creditInFavor > 0,
      total,
    )
    setRows(
      defaultMethodId
        ? [
            {
              methodId: defaultMethodId,
              amount: Math.max(round2(total - initialFavor), 0),
            },
          ]
        : [],
    )
    setUseCredit(creditInFavor > 0)
  }, [open, defaultMethodId, creditInFavor, total])

  const favorApplied = computeFavorApplied(creditInFavor, useCredit, total)
  const metrics = computeSplitMetrics(rows, methodIndex, total, favorApplied)

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
      : metrics.uncovered
        ? t("sell.split.uncovered", {
            amount: money(metrics.remaining, numberFormat),
          })
        : null

  const canConfirm =
    rows.length > 0 &&
    !metrics.nonCashOverpaid &&
    !metrics.creditExceeded &&
    !metrics.uncovered &&
    !pending

  const confirm = () => {
    const effective = capCashRows(rows, methodIndex, metrics.target)
    onConfirm(
      effective.map((row) => ({
        payment_method_id: row.methodId,
        monto: row.amount,
      })),
      metrics.vuelto,
    )
  }

  const coveredShown = round2(
    Math.min(metrics.paidSum + metrics.creditSum, metrics.target),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="split-dialog">
        <DialogHeader>
          <DialogTitle>{t("sell.split.title")}</DialogTitle>
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
                  <SelectValue placeholder={t("sell.split.method")} />
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
                aria-label={t("sell.split.amount")}
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
            {t("sell.split.addRow")}
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
              {t("sell.split.coveredLabel")}
            </span>
            <span data-testid="split-covered">
              {t("sell.split.covered", {
                amount: money(coveredShown, numberFormat),
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("sell.split.remainingLabel")}
            </span>
            <span data-testid="split-remaining">
              {t("sell.split.remaining", {
                amount: money(Math.max(metrics.remaining, 0), numberFormat),
              })}
            </span>
          </div>
          {metrics.vuelto > 0 &&
            !metrics.nonCashOverpaid &&
            !metrics.creditExceeded && (
              <div className="flex justify-between text-emerald-600">
                <span>{t("sell.changeDue", { change: "" }).trimEnd()}</span>
                <span data-testid="split-vuelto">
                  {t("sell.changeDue", {
                    change: money(metrics.vuelto, numberFormat),
                  })}
                </span>
              </div>
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
            {t("sell.split.confirm")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
