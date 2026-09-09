import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useAuth from "@/hooks/useAuth"
import { useT } from "@/i18n"
import { formatDateTimeStatic, moneyStatic } from "@/lib/format"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import CloseCashDialog from "./CloseCashDialog"
import OpenCashDialog from "./OpenCashDialog"
import { useOpenCashSession } from "./useOpenCashSession"

export function CashRegisterBar() {
  const t = useT()
  const { user } = useAuth()
  const [openOpen, setOpenOpen] = useState(false)
  const [openClose, setOpenClose] = useState(false)

  const canOpen = hasPermission(user, "cash.open")
  const canClose = hasPermission(user, "cash.close")

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
              time: formatDateTimeStatic(session.opened_at),
            })}
            {" · "}
            {t("cash.openingAmountLabel", {
              amount: moneyStatic(session.opening_amount),
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
          <Tooltip>
            {/* Disabled buttons swallow pointer events: the span keeps the
                tooltip reachable while the button stays non-interactive. */}
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="open-close-cash-dialog"
                  disabled={!canClose}
                  onClick={() => canClose && setOpenClose(true)}
                >
                  {t("cash.close")}
                </Button>
              </span>
            </TooltipTrigger>
            {!canClose && (
              <TooltipContent>{t("cash.noClosePermission")}</TooltipContent>
            )}
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  size="sm"
                  data-testid="open-open-cash-dialog"
                  disabled={!canOpen}
                  onClick={() => canOpen && setOpenOpen(true)}
                >
                  {t("cash.open")}
                </Button>
              </span>
            </TooltipTrigger>
            {!canOpen && (
              <TooltipContent>{t("cash.noOpenPermission")}</TooltipContent>
            )}
          </Tooltip>
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
