import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftRight } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FinancialAccountsService, TransfersService } from "@/client"
import { money } from "@/components/Reports/reportFormat"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useLocale, useT } from "@/i18n"
import { hasPermission } from "@/lib/permissions"
import { handleError } from "@/utils"

const formSchema = z
  .object({
    from_account_id: z
      .string()
      .min(1, { message: "Seleccioná la cuenta de origen" }),
    to_account_id: z
      .string()
      .min(1, { message: "Seleccioná la cuenta de destino" }),
    monto: z
      .string()
      .min(1, { message: "El monto es obligatorio" })
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, {
        message: "El monto debe ser mayor a cero",
      }),
    fecha: z.string().min(1, { message: "La fecha es obligatoria" }),
    descripcion: z.string().optional(),
  })
  .refine((data) => data.from_account_id !== data.to_account_id, {
    path: ["to_account_id"],
    message: "La cuenta de destino debe ser distinta de la de origen",
  })

type FormData = z.infer<typeof formSchema>

interface AddTransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function AddTransferDialog({
  open,
  onOpenChange,
  onCreated,
}: AddTransferDialogProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { user } = useAuth()
  // GET /financial-accounts requires finance.read; gate the query so it does
  // not fire (the dialog itself is only reachable with transfer.create).
  const canReadAccounts = hasPermission(user, "finance.read")

  const { data: accountsData } = useQuery({
    queryFn: () =>
      FinancialAccountsService.readFinancialAccounts({ skip: 0, limit: 100 }),
    queryKey: ["financial-accounts"],
    enabled: canReadAccounts,
  })
  const accounts = accountsData?.data ?? []

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      from_account_id: "",
      to_account_id: "",
      monto: "",
      fecha: new Date().toISOString().slice(0, 10),
      descripcion: "",
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        from_account_id: "",
        to_account_id: "",
        monto: "",
        fecha: new Date().toISOString().slice(0, 10),
        descripcion: "",
      })
    }
  }, [open, form])

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      TransfersService.createTransfer({
        requestBody: {
          from_account_id: data.from_account_id,
          to_account_id: data.to_account_id,
          monto: Number(data.monto),
          fecha: data.fecha,
          descripcion: data.descripcion || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("finance.transferCreated"))
      onOpenChange(false)
      onCreated()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-accounts"] })
      queryClient.invalidateQueries({ queryKey: ["transfers"] })
      queryClient.invalidateQueries({ queryKey: ["reports", "movements"] })
    },
  })

  const onSubmit = (data: FormData) => mutation.mutate(data)

  const accountOptions = (excludeId?: string) =>
    accounts.filter((a) => a.id !== excludeId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.transferTitle")}</DialogTitle>
          <DialogDescription>
            {t("finance.transferDescription")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="from_account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("finance.fromAccount")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("finance.selectAccount")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accountOptions().map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} ({money(a.saldo, numberFormat)})
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
                name="to_account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("finance.toAccount")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!form.watch("from_account_id")}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("finance.selectAccount")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accountOptions(form.watch("from_account_id")).map(
                          (a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name} ({money(a.saldo, numberFormat)})
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monto"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("common.amount")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fecha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("common.date")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="descripcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.description")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("finance.descriptionPlaceholder")}
                        maxLength={255}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={mutation.isPending}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <LoadingButton type="submit" loading={mutation.isPending}>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                {t("finance.createTransfer")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
