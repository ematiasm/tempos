import type { PaymentMethodPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"

interface QuickPaymentBarProps {
  methods: PaymentMethodPublic[]
  /** Disabled because of the cash-session gate / empty cart / pending mutation / missing customer. */
  disabledForPaid: boolean
  /** Same as disabledForPaid but the customer requirement is NOT included: credit buttons stay clickable so the guard can prompt. */
  disabledForCredit: boolean
  onPay: (method: PaymentMethodPublic) => void
}

/** Key badges shown on the first five quick buttons; F2..F6 mirror them. */
const PAYMENT_FKEYS = ["F2", "F3", "F4", "F5", "F6"]

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

/**
 * One quick button per payment method. A marks_paid method confirms the sale
 * in one click with a single full-total row; a credit (marks_paid = false)
 * method requires a customer (the parent guards and prompts). The first five
 * buttons show their F-key badge and a compact legend sits below the bar.
 */
export function QuickPaymentBar({
  methods,
  disabledForPaid,
  disabledForCredit,
  onPay,
}: QuickPaymentBarProps) {
  const t = useT()
  const gateTitle = t("cash.registerClosedHint")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {methods.map((method, index) => {
          const isCredit = method.marks_paid === false
          const disabled = isCredit ? disabledForCredit : disabledForPaid
          const fkey =
            index < PAYMENT_FKEYS.length ? PAYMENT_FKEYS[index] : null
          return (
            <Button
              key={method.id}
              type="button"
              data-testid="quick-pay-button"
              variant={isCredit ? "secondary" : "default"}
              size="sm"
              disabled={disabled}
              title={
                disabled
                  ? gateTitle
                  : fkey
                    ? t("sell.quickPayment.fkeyHint", { key: fkey })
                    : undefined
              }
              onClick={() => onPay(method)}
            >
              {fkey && <Kbd>{fkey}</Kbd>}
              {method.name}
            </Button>
          )
        })}
      </div>
      <p
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        data-testid="sell-shortcuts-legend"
      >
        <span className="inline-flex items-center gap-1">
          <Kbd>F2</Kbd>–<Kbd>F6</Kbd> {t("sell.shortcuts.pay")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Alt+C</Kbd> {t("sell.shortcuts.customer")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↑/↓</Kbd> {t("sell.shortcuts.selectLine")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>+/-</Kbd> {t("sell.shortcuts.adjustQty")}
        </span>
      </p>
    </div>
  )
}
