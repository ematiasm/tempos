import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import type { TaxAppliesTo, TaxPublic, TaxType } from "@/client"
import { TaxesService } from "@/client"
import BlockedByDocumentsDialog, {
  type DocumentRef,
  extractBlockedDocuments,
} from "@/components/Common/BlockedByDocumentsDialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
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
import { getTaxAppliesTo, getTaxTypes } from "./taxOptions"

const formSchema = z.object({
  name: z.string().min(1, { message: "El nombre es obligatorio" }),
  code: z.string().min(1, { message: "El código es obligatorio" }),
  tipo: z.enum(["IVA", "IIBB", "PercGan", "Interno", "Otro"] as const),
  rate: z.string().min(1, { message: "La tasa es obligatoria" }),
  is_percent: z.boolean(),
  aplica_a: z.enum(["linea", "documento"] as const),
  is_default: z.boolean(),
  is_active: z.boolean(),
})

type FormData = z.infer<typeof formSchema>

interface EditTaxProps {
  tax: TaxPublic
  onSuccess: () => void
}

const EditTax = ({ tax, onSuccess }: EditTaxProps) => {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [blockedDocuments, setBlockedDocuments] = useState<
    DocumentRef[] | null
  >(null)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const taxTypes = getTaxTypes(t)
  const taxAppliesTo = getTaxAppliesTo(t)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      name: tax.name,
      code: tax.code,
      tipo: tax.tipo as TaxType,
      rate: tax.rate,
      is_percent: tax.is_percent ?? true,
      aplica_a: (tax.aplica_a ?? "linea") as TaxAppliesTo,
      is_default: tax.is_default ?? false,
      is_active: tax.is_active ?? true,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const requestBody = {
        name: data.name,
        code: data.code,
        tipo: data.tipo as TaxType,
        rate: data.rate,
        is_percent: data.is_percent,
        aplica_a: data.aplica_a as TaxAppliesTo,
        is_default: data.is_default,
        is_active: data.is_active,
      }
      return TaxesService.updateTax({ taxId: tax.id, requestBody })
    },
    onSuccess: () => {
      showSuccessToast(t("admin.taxes.updated"))
      setIsOpen(false)
      onSuccess()
    },
    onError: (err) => {
      const docs = extractBlockedDocuments(err)
      if (docs) {
        setIsOpen(false)
        setBlockedDocuments(docs)
        return
      }
      handleError.bind(showErrorToast)(err as never)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["taxes"] })
    },
  })

  const onSubmit = (data: FormData) => mutation.mutate(data)

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          onClick={() => setIsOpen(true)}
        >
          <Pencil />
          {t("admin.taxes.edit")}
        </DropdownMenuItem>
        <DialogContent className="sm:max-w-md">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{t("admin.taxes.edit")}</DialogTitle>
                <DialogDescription>
                  {t("admin.taxes.editDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("common.name")}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("admin.taxes.code")}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tipo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("common.type")}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {taxTypes.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("admin.taxes.rate")}{" "}
                          <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="aplica_a"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("admin.taxes.appliesTo")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {taxAppliesTo.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
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
                    name="is_percent"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          {t("admin.taxes.isPercentage")}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="is_default"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          {t("admin.taxes.isDefault")}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="is_active"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          {t("admin.taxes.isActive")}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={mutation.isPending}>
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                <LoadingButton type="submit" loading={mutation.isPending}>
                  {t("common.save")}
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <BlockedByDocumentsDialog
        open={blockedDocuments !== null}
        onOpenChange={(open) => {
          if (!open) setBlockedDocuments(null)
        }}
        title={t("admin.taxes.editBlockedTitle")}
        hint={t("admin.taxes.editBlockedHint", {
          name: tax.name,
          count: blockedDocuments?.length ?? 0,
        })}
        documents={blockedDocuments ?? []}
      />
    </>
  )
}

export default EditTax
