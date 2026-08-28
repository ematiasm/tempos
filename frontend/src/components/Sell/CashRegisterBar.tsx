import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useLocale, useT } from "@/i18n"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import CloseCashDialog from "./CloseCashDialog"
import OpenCashDialog from "./OpenCashDialog"
import { useOpenCashSession } from "./useOpenCashSession"

const money = (
  value: number | string | null | undefined,
  format: "es" | "en",
) =>
  value == null || value === "" ? "—" : `$${formatMoney(Number(value), format)}`

export function CashRegisterBar() {
  const t = useT()
  const { numberFormat } = useLocale()
  const [openOpen, setOpenOpen] = useState(false)
  const [openClose, setOpenClose] = useState(false)

  const { session, isOpen } = useOpenCashSession()

  return (
    <div
      data-testid="cash-register-bar"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
        isOpen
          ? "border-emerald-600/40 bg-emerald-600/5"
          : "border-muted bg-muted/30",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">
          {isOpen ? t("cash.registerOpen") : t("cash.registerClosed")}
        </span>
        {isOpen && session && (
          <span className="text-xs text-muted-foreground">
            {t("cash.openedAt", {
              time: new Date(session.opened_at).toLocaleString(),
            })}
            {" · "}
            {t("cash.openingAmountLabel", {
              amount: money(session.opening_amount, numberFormat),
            })}
            {session.opened_by_name ? ` · ${session.opened_by_name}` : ""}
          </span>
        )}
        {!isOpen && (
          <span className="text-xs text-muted-foreground">
            {t("cash.registerClosedHint")}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {isOpen ? (
          <Button
            variant="destructive"
            size="sm"
            data-testid="open-close-cash-dialog"
            onClick={() => setOpenClose(true)}
          >
            {t("cash.close")}
          </Button>
        ) : (
          <Button
            size="sm"
            data-testid="open-open-cash-dialog"
            onClick={() => setOpenOpen(true)}
          >
            {t("cash.open")}
          </Button>
        )}
      </div>

      <OpenCashDialog open={openOpen} onOpenChange={setOpenOpen} />
      <CloseCashDialog
        open={openClose}
        onOpenChange={setOpenClose}
        session={session ?? null}
      />
    </div>
  )
}

export default CashRegisterBar
