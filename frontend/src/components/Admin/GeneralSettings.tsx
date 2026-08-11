import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { BusinessSettingsService, type TaxCondition } from "@/client"
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
  business_name: z
    .string()
    .min(1, { message: "La razón social es obligatoria" }),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z
    .string()
    .email({ message: "La dirección de correo es inválida" })
    .optional()
    .or(z.literal("")),
  cuit: z.string().optional(),
  condicion_fiscal: z.enum(["RI", "Monotributo", "Exento", "Consumidor Final"]),
  allow_negative_stock: z.boolean(),
  enable_variants: z.boolean(),
  default_iva: z.string().optional().or(z.literal("")),
})

type FormData = z.infer<typeof formSchema>

function GeneralSettings() {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [isEditing, setIsEditing] = useState(false)

  const TAX_CONDITIONS: { value: TaxCondition; label: string }[] = [
    { value: "RI", label: t("admin.general.taxRi") },
    { value: "Monotributo", label: t("admin.general.taxMonotributo") },
    { value: "Exento", label: t("admin.general.taxExento") },
    { value: "Consumidor Final", label: t("admin.general.taxConsumidorFinal") },
  ]

  const { data: settings } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
    enabled: true,
  })

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      business_name: settings?.business_name ?? "",
      address: settings?.address ?? "",
      phone: settings?.phone ?? "",
      email: settings?.email ?? "",
      cuit: settings?.cuit ?? "",
      condicion_fiscal:
        (settings?.condicion_fiscal as TaxCondition) ?? "Consumidor Final",
      allow_negative_stock: settings?.allow_negative_stock ?? false,
      enable_variants: settings?.enable_variants ?? false,
      default_iva: settings?.default_iva?.toString() ?? "",
    },
    values: settings
      ? {
          business_name: settings.business_name,
          address: settings.address ?? "",
          phone: settings.phone ?? "",
          email: settings.email ?? "",
          cuit: settings.cuit ?? "",
          condicion_fiscal: settings.condicion_fiscal as TaxCondition,
          allow_negative_stock: settings.allow_negative_stock,
          enable_variants: settings.enable_variants,
          default_iva: settings.default_iva?.toString() ?? "",
        }
      : undefined,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const requestBody: Record<string, unknown> = {
        business_name: data.business_name,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        cuit: data.cuit || null,
        condicion_fiscal: data.condicion_fiscal,
        allow_negative_stock: data.allow_negative_stock,
        enable_variants: data.enable_variants,
      }
      if (data.default_iva) {
        requestBody.default_iva = parseFloat(data.default_iva)
      }
      return BusinessSettingsService.updateBusinessSettings({
        requestBody,
      })
    },
    onSuccess: () => {
      showSuccessToast(t("admin.general.saved"))
      setIsEditing(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["business-settings"] })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  if (!settings) {
    return <div className="text-muted-foreground">{t("common.loading")}</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.general.title")}
          </h2>
          <p className="text-muted-foreground">{t("admin.general.subtitle")}</p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)}>{t("common.edit")}</Button>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-4 max-w-2xl">
            <FormField
              control={form.control}
              name="business_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("admin.general.businessName")}{" "}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("admin.general.businessNamePlaceholder")}
                      {...field}
                      disabled={!isEditing}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cuit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.general.cuit")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("admin.general.cuitPlaceholder")}
                        {...field}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="condicion_fiscal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.general.taxCondition")}</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("admin.general.selectTaxCondition")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TAX_CONDITIONS.map((tc) => (
                          <SelectItem key={tc.value} value={tc.value}>
                            {tc.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.general.phone")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("admin.general.phonePlaceholder")}
                        {...field}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("auth.email")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("admin.general.emailPlaceholder")}
                        {...field}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.general.address")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("admin.general.addressPlaceholder")}
                      {...field}
                      disabled={!isEditing}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="default_iva"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.general.defaultIva")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="21"
                      type="number"
                      {...field}
                      disabled={!isEditing}
                    />
                  </FormControl>
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
                        {t("admin.general.allowNegativeStock")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("admin.general.allowNegativeStockHint")}
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
                        {t("admin.general.enableVariants")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("admin.general.enableVariantsHint")}
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
                {t("admin.general.saveChanges")}
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

export default GeneralSettings
