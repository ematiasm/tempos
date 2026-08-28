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

/**
 * One quick button per payment method. A marks_paid method confirms the sale
 * in one click with a single full-total row; a credit (marks_paid = false)
 * method requires a customer (the parent guards and prompts).
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
    <div className="flex flex-wrap gap-2">
      {methods.map((method) => {
        const isCredit = method.marks_paid === false
        const disabled = isCredit ? disabledForCredit : disabledForPaid
        return (
          <Button
            key={method.id}
            type="button"
            data-testid="quick-pay-button"
            variant={isCredit ? "secondary" : "default"}
            size="sm"
            disabled={disabled}
            title={disabled ? gateTitle : undefined}
            onClick={() => onPay(method)}
          >
            {method.name}
          </Button>
        )
      })}
    </div>
  )
}
