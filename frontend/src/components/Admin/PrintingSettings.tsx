import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { BusinessSettingsService, type PrintFormat } from "@/client"
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
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { handleError } from "@/utils"

/**
 * Admin → Printing: default voucher print format and the voucher footer /
 * legends texts, persisted through the existing business-settings PATCH.
 */
function PrintingSettings() {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: settings } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
  })

  const formSchema = z.object({
    default_print_format: z.enum(["a4", "ticket80"]),
    voucher_footer: z
      .string()
      .max(255, { message: t("admin.printing.footerTooLong") }),
    voucher_legends: z
      .string()
      .max(500, { message: t("admin.printing.legendsTooLong") }),
  })

  type FormData = z.infer<typeof formSchema>

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      default_print_format: settings?.default_print_format ?? "a4",
      voucher_footer: settings?.voucher_footer ?? "",
      voucher_legends: settings?.voucher_legends ?? "",
    },
    values: settings
      ? {
          default_print_format: settings.default_print_format,
          voucher_footer: settings.voucher_footer ?? "",
          voucher_legends: settings.voucher_legends ?? "",
        }
      : undefined,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      BusinessSettingsService.updateBusinessSettings({
        requestBody: {
          default_print_format: data.default_print_format as PrintFormat,
          voucher_footer: data.voucher_footer.trim() || null,
          voucher_legends: data.voucher_legends.trim() || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("admin.printing.saved"))
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
          {t("admin.printing.title")}
        </h2>
        <p className="text-muted-foreground">{t("admin.printing.subtitle")}</p>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
          className="flex max-w-2xl flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="default_print_format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("admin.printing.format")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="printing-format">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="a4">
                      {t("admin.printing.formatA4")}
                    </SelectItem>
                    <SelectItem value="ticket80">
                      {t("admin.printing.formatTicket")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="voucher_footer"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("admin.printing.footer")}</FormLabel>
                <FormControl>
                  <Textarea
                    data-testid="printing-footer"
                    rows={2}
                    placeholder={t("admin.printing.footerHint")}
                    {...field}
                  />
                </FormControl>
                <FormMessage data-testid="printing-footer-error" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="voucher_legends"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("admin.printing.legends")}</FormLabel>
                <FormControl>
                  <Textarea
                    data-testid="printing-legends"
                    rows={3}
                    placeholder={t("admin.printing.legendsHint")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              data-testid="printing-save"
            >
              {t("admin.printing.save")}
            </LoadingButton>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default PrintingSettings
