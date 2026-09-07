import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, Mail, Printer } from "lucide-react"
import { useEffect, useState } from "react"

import type { DocumentPublic } from "@/client"
import { DocumentsService, PaymentMethodsService } from "@/client"
import { PrintVoucherDialog } from "@/components/Documents/VoucherPrint"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"
import { hasPermission } from "@/lib/permissions"
import { handleError } from "@/utils"

interface PostSaleDialogProps {
  /** The just-created document; kept in the parent so updates re-render the voucher. */
  document: DocumentPublic
  /** UI-only change due to the customer (never posted to the ledger). */
  vuelto: number
  onDocumentChange: (doc: DocumentPublic) => void
  onNewSale: () => void
}

/**
 * Post-sale hub: shows the issued sale (summary + vuelto) and the actions
 * print / email / save PDF / note / new sale. The document lives in the
 * parent (`/sell`), so a saved note re-renders the printed voucher.
 */
export function PostSaleDialog({
  document: doc,
  vuelto,
  onDocumentChange,
  onNewSale,
}: PostSaleDialogProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { user } = useAuth()

  const [printOpen, setPrintOpen] = useState(false)
  const [savePdf, setSavePdf] = useState(false)
  const [note, setNote] = useState(doc.notes ?? "")
  const [emailInputOpen, setEmailInputOpen] = useState(false)
  const [emailTo, setEmailTo] = useState("")

  useEffect(() => {
    setNote(doc.notes ?? "")
  }, [doc.notes])

  const canEmail = hasPermission(user, "document.email")
  const { data: emailStatus } = useQuery({
    queryFn: () => DocumentsService.readEmailStatus(),
    queryKey: ["documents-email-status"],
    enabled: canEmail,
  })
  const emailDisabled = canEmail && emailStatus?.emails_enabled === false

  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 1000 }),
    queryKey: ["payment-methods"],
  })
  const methodNames = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.name] as const),
  )
  const methodMarksPaid = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.marks_paid] as const),
  )
  // Same display rule as the voucher: credit rows are not payments.
  const paidRows = (doc.payments ?? []).filter(
    (p) => methodMarksPaid.get(p.payment_method_id) !== false,
  )
  const pendingAmount =
    Number(doc.total) -
    Number(doc.favor_monto ?? 0) -
    paidRows.reduce((sum, p) => sum + Number(p.monto), 0)

  const emailMutation = useMutation({
    mutationFn: (address: string | null) =>
      DocumentsService.emailDocument({
        documentId: doc.id,
        requestBody: address ? { email_to: address } : {},
      }),
    onSuccess: (_data, address) => {
      showSuccessToast(
        t("sell.postSale.emailSent", {
          to: address ?? doc.contraparte_email ?? "",
        }),
      )
      setEmailInputOpen(false)
      setEmailTo("")
    },
    onError: handleError.bind(showErrorToast),
  })

  const noteMutation = useMutation({
    mutationFn: (value: string) =>
      DocumentsService.updateDocumentNotes({
        documentId: doc.id,
        requestBody: { notes: value.trim() ? value : null },
      }),
    onSuccess: (updated) => {
      showSuccessToast(t("sell.postSale.noteSaved"))
      onDocumentChange(updated)
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleEmailClick = () => {
    if (doc.contraparte_email) {
      // auto-send: the document already carries the counterpart address
      emailMutation.mutate(null)
      return
    }
    setEmailInputOpen(true)
  }

  // --- Post-sale keyboard flow ---------------------------------------------
  // Enter / Escape start a new sale; P opens the print flow. The shortcuts
  // yield to any nested surface (print overlay, email prompt) and P is
  // ignored while typing, so the notes textarea never triggers a print.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
    }
    // buttons/links keep their native Enter activation, which already routes
    // to the focused action (new sale, print, save note, send email, ...)
    const isActivatableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === "BUTTON" || target.tagName === "A")

    const onKey = (e: KeyboardEvent) => {
      if (printOpen || emailInputOpen) return
      // safety net: a Radix dialog mounted anywhere wins over the shortcuts
      if (document.querySelector('[role="dialog"]')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === "Enter" || e.key === "Escape") {
        if (isTypingTarget(e.target) || isActivatableTarget(e.target)) return
        e.preventDefault()
        onNewSale()
        return
      }
      if (e.key === "p" || e.key === "P") {
        if (isTypingTarget(e.target)) return
        e.preventDefault()
        setSavePdf(false)
        setPrintOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [printOpen, emailInputOpen, onNewSale])

  return (
    <div
      data-testid="post-sale-dialog"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border py-10 text-center"
    >
      <CheckCircle2 className="h-12 w-12 text-emerald-500" />
      <div>
        <h2 className="text-xl font-semibold" data-testid="sale-success-numero">
          {doc.numero}
        </h2>
        <p className="text-muted-foreground">
          {t("sell.totaling", {
            total: money(Number(doc.total), numberFormat),
            customer: doc.contraparte_name ?? "",
          })}
        </p>
        {vuelto > 0 && (
          <p className="font-medium text-emerald-600" data-testid="sale-vuelto">
            {t("sell.changeDue", { change: money(vuelto, numberFormat) })}
          </p>
        )}
      </div>

      {paidRows.length > 0 && (
        <div className="w-full max-w-sm rounded-md bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            {t("voucher.payments")}
          </p>
          {paidRows.map((payment) => (
            <div
              key={payment.id}
              className="flex justify-between py-0.5 text-left"
            >
              <span className="text-muted-foreground">
                {methodNames.get(payment.payment_method_id) ??
                  payment.payment_method_id}
              </span>
              <span>{money(Number(payment.monto), numberFormat)}</span>
            </div>
          ))}
        </div>
      )}

      {paidRows.length === 0 && pendingAmount > 0 && (
        <div className="w-full max-w-sm rounded-md bg-muted/40 p-3 text-sm">
          <div className="flex justify-between font-medium">
            <span className="text-muted-foreground">
              {t("voucher.balancePending")}
            </span>
            <span>{money(pendingAmount, numberFormat)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => {
            setSavePdf(false)
            setPrintOpen(true)
          }}
        >
          <Printer className="mr-2 h-4 w-4" />
          {t("sell.printVoucher")}
        </Button>
        {canEmail && (
          <Button
            variant="outline"
            data-testid="post-sale-email"
            disabled={emailDisabled}
            title={
              emailDisabled ? t("sell.postSale.emailDisabledHint") : undefined
            }
            onClick={handleEmailClick}
          >
            <Mail className="mr-2 h-4 w-4" />
            {t("sell.postSale.email")}
          </Button>
        )}
        <Button
          variant="outline"
          data-testid="post-sale-save-pdf"
          onClick={() => {
            setSavePdf(true)
            setPrintOpen(true)
          }}
        >
          {t("sell.postSale.savePdf")}
        </Button>
        <Button
          variant="secondary"
          data-testid="post-sale-new-sale"
          onClick={onNewSale}
          autoFocus
        >
          {t("sell.newSale")}
        </Button>
      </div>

      {emailInputOpen && (
        <form
          className="flex w-full max-w-sm items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (emailTo.trim()) emailMutation.mutate(emailTo.trim())
          }}
        >
          <Input
            type="email"
            data-testid="post-sale-email-input"
            placeholder="cliente@ejemplo.com"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={emailMutation.isPending}>
            {t("sell.postSale.emailSend")}
          </Button>
        </form>
      )}

      <div className="w-full max-w-sm text-left">
        <label
          htmlFor="post-sale-note"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t("sell.postSale.notes")}
        </label>
        <Textarea
          id="post-sale-note"
          data-testid="post-sale-note"
          rows={2}
          maxLength={500}
          placeholder={t("sell.postSale.notesPlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            data-testid="post-sale-save-note"
            disabled={noteMutation.isPending}
            onClick={() => noteMutation.mutate(note)}
          >
            {t("sell.postSale.saveNote")}
          </Button>
        </div>
      </div>

      <PrintVoucherDialog
        document={doc}
        open={printOpen}
        onOpenChange={setPrintOpen}
        savePdf={savePdf}
      />
    </div>
  )
}

export default PostSaleDialog
