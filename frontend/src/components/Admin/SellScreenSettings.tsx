import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import {
  BusinessSettingsService,
  CustomersService,
  DocumentTypesService,
  type PaymentMethodPublic,
  PaymentMethodsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

const SALE_PREFIXES = ["FA", "FB", "FC", "TCK"]

/** Radix Select rejects empty-string values, so sentinels stand for NULLs. */
const AUTO_DOC_TYPE = "__auto__"
const NO_CUSTOMER = "__none__"

/**
 * Admin → Sell screen: quick payment shortcuts (selection + order), default
 * sale document type, default customer and the price-edit / date policies,
 * persisted through the existing business-settings PATCH.
 */
function SellScreenSettings() {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: settings } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
  })
  const { data: methodsData } = useQuery({
    queryFn: () => PaymentMethodsService.readPaymentMethods(),
    queryKey: ["payment-methods"],
  })
  const { data: typesData } = useQuery({
    queryFn: () => DocumentTypesService.readDocumentTypes(),
    queryKey: ["document-types"],
  })
  const { data: customersData } = useQuery({
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 1000 }),
    queryKey: ["customers"],
  })

  const methods: PaymentMethodPublic[] = methodsData?.data ?? []
  const saleTypes = useMemo(
    () =>
      (typesData?.data ?? []).filter(
        (dt) =>
          dt.is_active &&
          dt.operation === "venta" &&
          SALE_PREFIXES.includes(dt.prefix),
      ),
    [typesData],
  )
  const customers = (customersData?.data ?? []).filter(
    (c) => c.is_active !== false,
  )

  const formSchema = z.object({
    sell_quick_method_ids: z.array(z.string()),
    sell_default_document_type_id: z.string(),
    sell_default_customer_id: z.string(),
    sell_block_price_edit: z.boolean(),
    sell_hide_date: z.boolean(),
  })

  type FormData = z.infer<typeof formSchema>

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sell_quick_method_ids: settings?.sell_quick_method_ids ?? [],
      sell_default_document_type_id:
        settings?.sell_default_document_type_id ?? AUTO_DOC_TYPE,
      sell_default_customer_id:
        settings?.sell_default_customer_id ?? NO_CUSTOMER,
      sell_block_price_edit: settings?.sell_block_price_edit ?? true,
      sell_hide_date: settings?.sell_hide_date ?? false,
    },
    values: settings
      ? {
          sell_quick_method_ids: settings.sell_quick_method_ids ?? [],
          sell_default_document_type_id:
            settings.sell_default_document_type_id ?? AUTO_DOC_TYPE,
          sell_default_customer_id:
            settings.sell_default_customer_id ?? NO_CUSTOMER,
          sell_block_price_edit: settings.sell_block_price_edit,
          sell_hide_date: settings.sell_hide_date,
        }
      : undefined,
  })

  const quickIds = form.watch("sell_quick_method_ids")
  const methodById = useMemo(
    () => new Map(methods.map((m) => [m.id, m])),
    [methods],
  )

  const toggleMethod = (methodId: string, checked: boolean) => {
    const current = form.getValues("sell_quick_method_ids")
    form.setValue(
      "sell_quick_method_ids",
      checked
        ? current.includes(methodId)
          ? current
          : [...current, methodId]
        : current.filter((id) => id !== methodId),
      { shouldDirty: true },
    )
  }

  const moveMethod = (index: number, direction: -1 | 1) => {
    const current = [...form.getValues("sell_quick_method_ids")]
    const target = index + direction
    if (target < 0 || target >= current.length) return
    ;[current[index], current[target]] = [current[target], current[index]]
    form.setValue("sell_quick_method_ids", current, { shouldDirty: true })
  }

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      BusinessSettingsService.updateBusinessSettings({
        requestBody: {
          // unknown/stale ids are dropped so the stored list stays resolvable
          sell_quick_method_ids: data.sell_quick_method_ids.filter((id) =>
            methodById.has(id),
          ).length
            ? data.sell_quick_method_ids.filter((id) => methodById.has(id))
            : null,
          sell_default_document_type_id:
            data.sell_default_document_type_id === AUTO_DOC_TYPE
              ? null
              : data.sell_default_document_type_id,
          sell_default_customer_id:
            data.sell_default_customer_id === NO_CUSTOMER
              ? null
              : data.sell_default_customer_id,
          sell_block_price_edit: data.sell_block_price_edit,
          sell_hide_date: data.sell_hide_date,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("admin.sellScreen.saved"))
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["business-settings"] })
    },
  })

  if (!settings) {
    return <div className="text-muted-foreground">{t("common.loading")}</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          {t("admin.sellScreen.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("admin.sellScreen.subtitle")}
        </p>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
          className="flex max-w-2xl flex-col gap-6"
        >
          <FormField
            control={form.control}
            name="sell_quick_method_ids"
            render={() => (
              <FormItem>
                <FormLabel>{t("admin.sellScreen.quickMethods")}</FormLabel>
                <p className="text-xs text-muted-foreground">
                  {t("admin.sellScreen.quickMethodsHint")}
                </p>
                {methods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("admin.sellScreen.noMethods")}
                  </p>
                ) : (
                  <FormControl>
                    <div className="flex flex-wrap gap-2">
                      {methods.map((method) => {
                        const checked = quickIds.includes(method.id)
                        return (
                          <div
                            key={method.id}
                            data-testid="sellscreen-method-chip"
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                              checked && "border-primary bg-primary/10",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                toggleMethod(method.id, c === true)
                              }
                            />
                            <button
                              type="button"
                              className="cursor-pointer"
                              onClick={() => toggleMethod(method.id, !checked)}
                            >
                              {method.name}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </FormControl>
                )}
                {quickIds.filter((id) => methodById.has(id)).length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("admin.sellScreen.selectedOrder")}
                    </span>
                    {quickIds.map((id, index) => {
                      const method = methodById.get(id)
                      if (!method) return null
                      return (
                        <div
                          key={id}
                          data-testid="sellscreen-order-item"
                          className="flex items-center justify-between rounded-md border px-2 py-1 text-sm"
                        >
                          <span>
                            {index + 1}. {method.name}
                          </span>
                          <span className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={index === 0}
                              data-testid="sellscreen-move-up"
                              aria-label={t("admin.sellScreen.moveUp")}
                              onClick={() => moveMethod(index, -1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={index === quickIds.length - 1}
                              data-testid="sellscreen-move-down"
                              aria-label={t("admin.sellScreen.moveDown")}
                              onClick={() => moveMethod(index, 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="sell_default_document_type_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.sellScreen.defaultDocType")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="sellscreen-doc-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={AUTO_DOC_TYPE}>
                        {t("admin.sellScreen.defaultDocTypeAuto")}
                      </SelectItem>
                      {saleTypes.map((saleType) => (
                        <SelectItem key={saleType.id} value={saleType.id}>
                          {saleType.name} ({saleType.prefix})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sell_default_customer_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.sellScreen.defaultCustomer")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="sellscreen-customer">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CUSTOMER}>
                        {t("admin.sellScreen.defaultCustomerNone")}
                      </SelectItem>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.razon_social}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="sell_block_price_edit"
            render={({ field }) => (
              <FormItem className="flex flex-col gap-1 space-y-0">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="sellscreen-block-price"
                  />
                  <FormLabel className="font-normal">
                    {t("admin.sellScreen.blockPriceEdit")}
                  </FormLabel>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.sellScreen.blockPriceEditHint")}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sell_hide_date"
            render={({ field }) => (
              <FormItem className="flex flex-col gap-1 space-y-0">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="sellscreen-hide-date"
                  />
                  <FormLabel className="font-normal">
                    {t("admin.sellScreen.hideDate")}
                  </FormLabel>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.sellScreen.hideDateHint")}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              data-testid="sellscreen-save"
            >
              {t("admin.sellScreen.save")}
            </LoadingButton>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default SellScreenSettings
