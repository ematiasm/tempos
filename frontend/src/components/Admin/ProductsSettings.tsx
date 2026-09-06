import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { BusinessSettingsService, UomsService } from "@/client"
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
import { Input } from "@/components/ui/input"
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
import { handleError } from "@/utils"

const formSchema = z.object({
  allow_negative_stock: z.boolean(),
  enable_variants: z.boolean(),
  stock_policy: z.enum(["block", "warn"]),
  default_margen_pct: z.string().optional().or(z.literal("")),
  warn_below_cost: z.boolean(),
  require_barcode: z.boolean(),
  default_uom_id: z.string().optional(),
})

type FormData = z.infer<typeof formSchema>

/**
 * Admin → Products: stock policies and the defaults prefilled when creating
 * a product, persisted through the existing business-settings PATCH. Only
 * these fields are sent so this form never fights the other settings forms.
 */
function ProductsSettings() {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [isEditing, setIsEditing] = useState(false)

  const { data: settings } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
    enabled: true,
  })

  const { data: uomsData } = useQuery({
    queryFn: () => UomsService.readUoms({ skip: 0, limit: 1000 }),
    queryKey: ["uoms"],
  })
  const uoms = uomsData?.data ?? []

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      allow_negative_stock: settings?.allow_negative_stock ?? false,
      enable_variants: settings?.enable_variants ?? false,
      stock_policy: settings?.stock_policy ?? "warn",
      default_margen_pct: settings?.default_margen_pct?.toString() ?? "",
      warn_below_cost: settings?.warn_below_cost ?? false,
      require_barcode: settings?.require_barcode ?? false,
      default_uom_id: settings?.default_uom_id ?? "",
    },
    values: settings
      ? {
          allow_negative_stock: settings.allow_negative_stock,
          enable_variants: settings.enable_variants,
          stock_policy: settings.stock_policy,
          default_margen_pct: settings.default_margen_pct?.toString() ?? "",
          warn_below_cost: settings.warn_below_cost,
          require_barcode: settings.require_barcode,
          default_uom_id: settings.default_uom_id ?? "",
        }
      : undefined,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      BusinessSettingsService.updateBusinessSettings({
        requestBody: {
          allow_negative_stock: data.allow_negative_stock,
          enable_variants: data.enable_variants,
          stock_policy: data.stock_policy,
          default_margen_pct: data.default_margen_pct
            ? parseFloat(data.default_margen_pct)
            : null,
          warn_below_cost: data.warn_below_cost,
          require_barcode: data.require_barcode,
          default_uom_id: data.default_uom_id || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("admin.products.saved"))
      setIsEditing(false)
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.products.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.products.subtitle")}
          </p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)}>{t("common.edit")}</Button>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
          <div className="grid gap-4 max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="default_margen_pct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.products.defaultMarginPct")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="21"
                        type="number"
                        {...field}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.products.defaultMarginPctHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="default_uom_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.products.defaultUom")}</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value || "")}
                      value={field.value}
                      disabled={!isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("admin.products.noDefault")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {uoms.map((uom) => (
                          <SelectItem key={uom.id} value={uom.id}>
                            {uom.name} ({uom.abbreviation})
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
              name="stock_policy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.products.stockPolicy")}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!isEditing}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="block">
                        {t("admin.products.stockPolicyBlock")}
                      </SelectItem>
                      <SelectItem value="warn">
                        {t("admin.products.stockPolicyWarn")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-4 pt-2">
              <FormField
                control={form.control}
                name="allow_negative_stock"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">
                        {t("admin.products.allowNegativeStock")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("admin.products.allowNegativeStockHint")}
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="enable_variants"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">
                        {t("admin.products.enableVariants")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("admin.products.enableVariantsHint")}
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="require_barcode"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">
                        {t("admin.products.requireBarcode")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("admin.products.requireBarcodeHint")}
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="warn_below_cost"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">
                        {t("admin.products.warnBelowCost")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("admin.products.warnBelowCostHint")}
                      </p>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex gap-2 mt-6">
              <LoadingButton type="submit" loading={mutation.isPending}>
                {t("admin.products.saveChanges")}
              </LoadingButton>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditing(false)
                  form.reset()
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </form>
      </Form>
    </div>
  )
}

export default ProductsSettings
