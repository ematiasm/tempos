import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import {
  CategoriesService,
  type ProductCreate,
  ProductsService,
  TaxesService,
  UomsService,
} from "@/client"
import { buildCategoryRows } from "@/components/Admin/categoryColumns"
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
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { handleError } from "@/utils"

const formSchema = z.object({
  name: z.string().min(1, { message: "El nombre es obligatorio" }),
  sku: z.string().optional().or(z.literal("")),
  uom_id: z.string().min(1, { message: "La unidad de medida es obligatoria" }),
  category_id: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  margen_pct: z.string().min(1, { message: "El margen es obligatorio" }),
  costo_actual: z.string().min(1, { message: "El costo es obligatorio" }),
  stock_minimo: z.string().optional().or(z.literal("")),
  stock_maximo: z.string().optional().or(z.literal("")),
  tax_ids: z.array(z.string()),
})

type FormData = z.infer<typeof formSchema>

const AddProduct = () => {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab] = useState("details")
  const [newBarcode, setNewBarcode] = useState("")
  const [barcodes, setBarcodes] = useState<string[]>([])
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: uomsData } = useQuery({
    queryFn: () => UomsService.readUoms({ skip: 0, limit: 100 }),
    queryKey: ["uoms"],
  })
  const { data: categoriesData } = useQuery({
    queryFn: () => CategoriesService.readCategories({ skip: 0, limit: 100 }),
    queryKey: ["categories"],
  })
  const { data: taxesData } = useQuery({
    queryFn: () => TaxesService.readTaxes({ skip: 0, limit: 100 }),
    queryKey: ["taxes"],
  })

  const uoms = uomsData?.data ?? []
  const categories = categoriesData?.data ?? []
  const taxes = taxesData?.data ?? []
  const categoryRows = buildCategoryRows(categories)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      name: "",
      sku: "",
      uom_id: "",
      category_id: "",
      description: "",
      margen_pct: "0",
      costo_actual: "0",
      stock_minimo: "",
      stock_maximo: "",
      tax_ids: [],
    },
  })

  const costoStr = form.watch("costo_actual")
  const margenStr = form.watch("margen_pct")
  const costo = parseFloat(costoStr) || 0
  const margen = parseFloat(margenStr) || 0
  const precioPreview = (costo * (1 + margen / 100)).toFixed(2)

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const requestBody: ProductCreate = {
        name: data.name,
        sku: data.sku || null,
        uom_id: data.uom_id,
        category_id: data.category_id || null,
        description: data.description || null,
        margen_pct: parseFloat(data.margen_pct) || 0,
        costo_actual: parseFloat(data.costo_actual) || 0,
        is_active: true,
        tax_ids: data.tax_ids,
      }
      if (data.stock_minimo)
        requestBody.stock_minimo = parseFloat(data.stock_minimo)
      if (data.stock_maximo)
        requestBody.stock_maximo = parseFloat(data.stock_maximo)
      const product = await ProductsService.createProduct({ requestBody })
      // Add barcodes sequentially (each call is independent per-id)
      for (const code of barcodes) {
        if (code.trim()) {
          await ProductsService.addBarcode({
            productId: product.id,
            requestBody: { code: code.trim(), product_id: product.id },
          })
        }
      }
      return product
    },
    onSuccess: () => {
      showSuccessToast(t("products.created"))
      form.reset()
      setBarcodes([])
      setNewBarcode("")
      setTab("details")
      setIsOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const onSubmit = (data: FormData) => mutation.mutate(data)

  const toggleTax = (taxId: string, checked: boolean) => {
    const current = form.getValues("tax_ids")
    if (checked) {
      form.setValue("tax_ids", [...current, taxId])
    } else {
      form.setValue(
        "tax_ids",
        current.filter((id) => id !== taxId),
      )
    }
  }

  const addBarcode = () => {
    const code = newBarcode.trim()
    if (!code) return
    if (barcodes.includes(code)) {
      showErrorToast(t("products.barcodeDuplicate"))
      return
    }
    setBarcodes([...barcodes, code])
    setNewBarcode("")
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        setIsOpen(o)
        if (!o) {
          form.reset()
          setBarcodes([])
          setNewBarcode("")
          setTab("details")
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="my-4">
          <Plus className="mr-2" />
          {t("products.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("products.add")}</DialogTitle>
          <DialogDescription>{t("products.addHint")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} id="add-product-form">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="details">
                  {t("products.details")}
                </TabsTrigger>
                <TabsTrigger value="taxes">{t("products.taxes")}</TabsTrigger>
                <TabsTrigger value="barcodes">
                  {t("products.barcodes")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details">
                <div className="grid gap-4 py-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("products.name")}{" "}
                          <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("products.namePlaceholder")}
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
                      name="sku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("products.sku")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("common.optional")}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="uom_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("products.unit")}{" "}
                            <span className="text-destructive">*</span>
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("products.selectUnit")}
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
                    name="category_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.category")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("products.noCategory")}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categoryRows.map((row) => (
                              <SelectItem key={row.id} value={row.id}>
                                {row.depth > 0
                                  ? `${"  ".repeat(row.depth)}└ ${row.name}`
                                  : row.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="costo_actual"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("products.cost")}{" "}
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
                      name="margen_pct"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("products.marginPct")}{" "}
                            <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormItem>
                      <FormLabel>{t("products.salePrice")}</FormLabel>
                      <Input
                        value={`$${precioPreview}`}
                        disabled
                        className="bg-muted"
                      />
                    </FormItem>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="stock_minimo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("products.minStock")}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.001"
                              placeholder={t("common.optional")}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="stock_maximo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("products.maxStock")}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.001"
                              placeholder={t("common.optional")}
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
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.description")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("common.optional")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="taxes">
                <div className="grid gap-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    {t("products.taxesHint")}
                  </p>
                  {taxes.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("products.noTaxes")}
                    </p>
                  )}
                  {taxes.map((tax) => {
                    const isChecked = form.getValues("tax_ids").includes(tax.id)
                    return (
                      <button
                        type="button"
                        key={tax.id}
                        onClick={() => toggleTax(tax.id, !isChecked)}
                        className="flex items-center gap-2 cursor-pointer text-sm border rounded px-2 py-1.5 text-left w-full"
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(c) => toggleTax(tax.id, c === true)}
                        />
                        <div>
                          {tax.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {tax.code}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </TabsContent>

              <TabsContent value="barcodes">
                <div className="grid gap-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    {t("products.barcodesAddHint")}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("products.barcodePlaceholder")}
                      value={newBarcode}
                      onChange={(e) => setNewBarcode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addBarcode()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addBarcode}
                      disabled={!newBarcode.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {barcodes.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("products.noBarcodes")}
                    </p>
                  )}
                  <ul className="divide-y rounded border">
                    {barcodes.map((b) => (
                      <li
                        key={b}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <span className="font-mono text-sm">{b}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setBarcodes(barcodes.filter((x) => x !== b))
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={mutation.isPending}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <LoadingButton
                type="submit"
                form="add-product-form"
                loading={mutation.isPending}
              >
                {t("common.save")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default AddProduct
