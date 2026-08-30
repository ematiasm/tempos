import type { ReactNode, RefObject } from "react"
import type { CustomerPublic, DocumentTypePublic } from "@/client"
import {
  CounterpartCombobox,
  type CounterpartComboboxControls,
} from "@/components/Common/CounterpartCombobox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"

interface SellSidebarProps {
  customers: CustomerPublic[]
  saleTypes: DocumentTypePublic[]
  selectedCustomer: CustomerPublic | null
  customerId: string | null
  onCustomerChange: (customerId: string | null) => void
  /** Imperative handle for the Alt+C customer shortcut. */
  customerControlsRef?: RefObject<CounterpartComboboxControls | null>
  docTypeId: string | null
  onDocTypeChange: (docTypeId: string) => void
  date: string
  onDateChange: (date: string) => void
  discountTotal: number
  onDiscountChange: (discount: number) => void
  /** Config-driven: hides the date selector (sales use today). */
  hideDate?: boolean
  notes: string
  onNotesChange: (notes: string) => void
  subtotal: number
  perceptions: number
  total: number
  appliedFavor: number
  children?: ReactNode
}

export function SellSidebar({
  customers,
  saleTypes,
  selectedCustomer,
  customerId,
  onCustomerChange,
  customerControlsRef,
  docTypeId,
  onDocTypeChange,
  date,
  onDateChange,
  discountTotal,
  onDiscountChange,
  hideDate = false,
  notes,
  onNotesChange,
  subtotal,
  perceptions,
  total,
  appliedFavor,
  children,
}: SellSidebarProps) {
  const t = useT()
  const { numberFormat } = useLocale()

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border p-4 lg:w-[340px]">
      <div className="grid gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("sell.customer")}
          </span>
          <CounterpartCombobox
            items={customers.map((c) => ({
              id: c.id,
              razon_social: c.razon_social,
              documento: c.documento ?? null,
              saldo: c.saldo,
            }))}
            value={customerId}
            onChange={onCustomerChange}
            allowNone
            noneLabel={t("sell.noCustomer")}
            placeholder={t("sell.selectCustomer")}
            triggerTestId="customer-select"
            controlsRef={customerControlsRef}
          />
          {selectedCustomer && Number(selectedCustomer.saldo) !== 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("sell.balance", {
                balance: money(Number(selectedCustomer.saldo), numberFormat),
              })}
            </p>
          )}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("sell.documentType")}
          </span>
          <Select value={docTypeId ?? ""} onValueChange={onDocTypeChange}>
            <SelectTrigger>
              <SelectValue placeholder={t("sell.auto")} />
            </SelectTrigger>
            <SelectContent>
              {saleTypes.map((saleType) => (
                <SelectItem key={saleType.id} value={saleType.id}>
                  {saleType.name} ({saleType.prefix})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!hideDate && (
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("sell.date")}
            </span>
            <Input
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
            />
          </div>
        )}

        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("sell.documentDiscount")}
          </span>
          <Input
            type="number"
            step="0.01"
            value={discountTotal}
            onChange={(e) => onDiscountChange(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("sell.subtotal")}</span>
          <span>{money(subtotal, numberFormat)}</span>
        </div>
        {discountTotal > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("sell.discount")}</span>
            <span>-{money(discountTotal, numberFormat)}</span>
          </div>
        )}
        {perceptions > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("sell.perceptions")}
            </span>
            <span>{money(perceptions, numberFormat)}</span>
          </div>
        )}
        <div className="flex justify-between border-t font-semibold">
          <span>{t("sell.total")}</span>
          <span>{money(total, numberFormat)}</span>
        </div>
        {appliedFavor > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t("sell.creditInFavor")}
            </span>
            <span>-{money(appliedFavor, numberFormat)}</span>
          </div>
        )}
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("sell.notesLabel")}
        </span>
        <Textarea
          data-testid="sell-notes"
          rows={2}
          maxLength={500}
          placeholder={t("sell.postSale.notesPlaceholder")}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </div>

      {children}
    </div>
  )
}
