import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import {
  ApiError,
  type SetupCreate,
  SetupService,
  type TaxCondition,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { setupStatusQueryOptions, useSetupStatus } from "@/hooks/useSetupStatus"
import { formatStatic, useT } from "@/i18n"
import { handleError } from "@/utils"

// Validation messages mirror the Admin General tab form (established
// convention: zod schemas keep hardcoded Spanish messages).
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
  default_locale: z.enum(["es", "en"]),
  load_demo_data: z.boolean(),
})

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/setup")({
  component: Setup,
  beforeLoad: async ({ context }) => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }
    let setupCompleted: boolean | null = null
    try {
      const status = await context.queryClient.ensureQueryData(
        setupStatusQueryOptions(),
      )
      setupCompleted = status.setup_completed
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({ to: "/login" })
      }
      // Fail open on other errors (e.g. network): render the wizard and let
      // the submit surface the real API error.
    }
    if (setupCompleted) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [
      {
        title: `${formatStatic("setup.title")} - tempos`,
      },
    ],
  }),
})

function Setup() {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { logout } = useAuth()

  // Same labels as the Admin General tab so both screens look identical.
  const TAX_CONDITIONS: { value: TaxCondition; label: string }[] = [
    { value: "RI", label: t("admin.general.taxRi") },
    { value: "Monotributo", label: t("admin.general.taxMonotributo") },
    { value: "Exento", label: t("admin.general.taxExento") },
    { value: "Consumidor Final", label: t("admin.general.taxConsumidorFinal") },
  ]

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      business_name: "",
      address: "",
      phone: "",
      email: "",
      cuit: "",
      condicion_fiscal: "Consumidor Final",
      default_locale: "es",
      load_demo_data: false,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const requestBody: SetupCreate = {
        business_name: data.business_name,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        cuit: data.cuit || null,
        condicion_fiscal: data.condicion_fiscal,
        default_locale: data.default_locale,
        load_demo_data: data.load_demo_data,
      }
      return SetupService.runSetup({ requestBody })
    },
    onSuccess: (settings) => {
      // Seed the caches before navigating so the layout guard sees the
      // system as configured without an extra round trip.
      queryClient.setQueryData(setupStatusQueryOptions().queryKey, {
        setup_completed: true,
      })
      queryClient.setQueryData(["business-settings"], settings)
      showSuccessToast(t("setup.completed"))
      navigate({ to: "/" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const { data: status } = useSetupStatus()

  // If setup completes elsewhere (e.g. another tab), leave the wizard.
  useEffect(() => {
    if (status?.setup_completed) {
      navigate({ to: "/" })
    }
  }, [status, navigate])

  const onSubmit = (data: FormData) => {
    if (mutation.isPending) return
    mutation.mutate(data)
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">{t("setup.title")}</CardTitle>
          <CardDescription>{t("setup.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
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
                      <FormLabel>
                        {t("admin.general.taxCondition")}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "admin.general.selectTaxCondition",
                              )}
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

              <FormField
                control={form.control}
                name="default_locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.general.defaultLocale")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="setup-language-select">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="es">
                          {t("admin.general.localeEs")}
                        </SelectItem>
                        <SelectItem value="en">
                          {t("admin.general.localeEn")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      {t("setup.languageHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                          type="email"
                          {...field}
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
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="load_demo_data"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">
                        {t("setup.loadDemoData")}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t("setup.loadDemoDataHint")}
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              <div className="flex gap-2 pt-2">
                <LoadingButton type="submit" loading={mutation.isPending}>
                  {t("setup.submit")}
                </LoadingButton>
                <Button type="button" variant="outline" onClick={logout}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
