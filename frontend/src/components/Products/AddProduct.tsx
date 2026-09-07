import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
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
import PriceChainPreview from "@/components/Products/PriceChainPreview"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
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
import {
  computePriceChain,
  countSelectedIvas,
  margenPctFromNeto,
} from "@/lib/pricing"
import { handleError } from "@/utils"

const formSchema = z
  .object({
    name: z.string().min(1, { message: "El nombre es obligatorio" }),
    sku: z.string().optional().or(z.literal("")),
    uom_id: z
      .string()
      .min(1, { message: "La unidad de medida es obligatoria" }),
    category_id: z.string().optional().or(z.literal("")),
    description: z.string().optional().or(z.literal("")),
    margen_pct: z.string().min(1, { message: "El margen es obligatorio" }),
    costo_actual: z.string().min(1, { message: "El costo es obligatorio" }),
    stock_minimo: z.string().optional().or(z.literal("")),
    stock_maximo: z.string().optional().or(z.literal("")),
    allow_price_edit_in_sale: z.boolean(),
  })
  .refine(
    (data) => {
      if (!data.stock_minimo || !data.stock_maximo) return true
      return parseFloat(data.stock_maximo) >= parseFloat(data.stock_minimo)
    },
    {
      message: "El máximo no puede ser menor que el mínimo",
      path: ["stock_maximo"],
    },
  )

type FormData = z.infer<typeof formSchema>

const AddProduct = () => {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab] = useState("details")
  const [newBarcode, setNewBarcode] = useState("")
  // When the user is typing a net price directly, keep the raw draft here so
  // keystrokes are not overwritten by the chain-derived value; it resets on
  // blur or whenever the cost changes (the chain then drives the field again).
  const [netoDraft, setNetoDraft] = useState<string | null>(null)
  const [barcodes, setBarcodes] = useState<string[]>([])
  const [selectedTaxIds, setSelectedTaxIds] = useState<string[]>([])
  const [barcodeError, setBarcodeError] = useState(false)
  const taxesTouchedRef = useRef(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { settings } = useBusinessSettings()
  // UI-only product defaults (client-side prefills; the backend never enforces)
  const requireBarcode = settings?.require_barcode ?? false

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
  const defaultTaxIds = taxes
    .filter((tax) => tax.is_default)
    .map((tax) => tax.id)
  const defaultTaxIdsKey = defaultTaxIds.join(",")
  const categoryRows = buildCategoryRows(categories)

  useEffect(() => {
    if (isOpen && defaultTaxIdsKey && !taxesTouchedRef.current) {
      setSelectedTaxIds(defaultTaxIdsKey.split(","))
    }
  }, [isOpen, defaultTaxIdsKey])

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
      allow_price_edit_in_sale: false,
    },
  })

  // Prefill the configured default margin and unit of measure each time the
  // dialog opens (form.reset() on close restores the static defaults).
  const defaultMargenPct = settings?.default_margen_pct
  const defaultUomId = settings?.default_uom_id
  useEffect(() => {
    if (!isOpen) return
    if (defaultMargenPct != null) {
      form.setValue("margen_pct", String(defaultMargenPct))
    }
    if (defaultUomId) {
      form.setValue("uom_id", defaultUomId)
    }
    setNetoDraft(null)
  }, [isOpen, defaultMargenPct, defaultUomId, form])

  const costoStr = form.watch("costo_actual")
  const margenStr = form.watch("margen_pct")
  const costo = parseFloat(costoStr) || 0
  const margen = parseFloat(margenStr) || 0
  const selectedTaxes = taxes.filter((tax) => selectedTaxIds.includes(tax.id))

  // Editing the net price derives the margin (the stored input); the chain
  // then recomputes the displayed neto from that margin, so both stay
  // consistent. Negative margins are allowed (shown as a warning).
  const handleNetoChange = (raw: string) => {
    setNetoDraft(raw)
    const neto = parseFloat(raw)
    if (Number.isFinite(neto) && costo > 0) {
      form.setValue("margen_pct", String(margenPctFromNeto(costo, neto)), {
        shouldValidate: true,
      })
    }
  }
  const chain = computePriceChain({
    costo,
    margenPct: margen,
    taxes: selectedTaxes,
    rounding: settings?.price_rounding,
  })
  // Backend rule mirrored in the UI: at most one tipo-IVA tax per product.
  const multipleIvas = countSelectedIvas(taxes, selectedTaxIds)
  const ivaTaxes = taxes.filter((tax) => tax.tipo === "IVA")
  const otherTaxes = taxes.filter((tax) => tax.tipo !== "IVA")
  const selectedIvaId =
    ivaTaxes.find((tax) => selectedTaxIds.includes(tax.id))?.id ?? null

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
        allow_price_edit_in_sale: data.allow_price_edit_in_sale,
        tax_ids: selectedTaxIds,
      }
      if (data.stock_minimo)
        requestBody.stock_minimo = parseFloat(data.stock_minimo)
      if (data.stock_maximo) {
        requestBody.stock_maximo = parseFloat(data.stock_maximo)
      } else {
        // The maximum is required by the API: fill up to the minimum
        // (order-up-to-min), or 0 when there is no minimum either.
        requestBody.stock_maximo = data.stock_minimo
          ? parseFloat(data.stock_minimo)
          : 0
      }
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
      setSelectedTaxIds([])
      taxesTouchedRef.current = false
      setBarcodeError(false)
      setTab("details")
      setIsOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["product-counts"] })
    },
  })

  const onSubmit = (data: FormData) => {
    // UI-only rule: when the setting is on, a product needs at least one
    // barcode. The backend deliberately does not enforce this.
    if (requireBarcode && barcodes.length === 0) {
      setBarcodeError(true)
      setTab("barcodes")
      showErrorToast(t("products.barcodeRequired"))
      return
    }
    // Defensive guard (the radio picker already prevents this): the backend
    // rejects multiple IVAs with `multiple_iva_taxes`.
    if (multipleIvas > 1) {
      setTab("taxes")
      showErrorToast(t("errors.multiple_iva_taxes"))
      return
    }
    mutation.mutate(data)
  }

  const toggleTax = (taxId: string, checked: boolean) => {
    taxesTouchedRef.current = true
    const tax = taxes.find((t) => t.id === taxId)
    setSelectedTaxIds((current) => {
      if (!checked) return current.filter((id) => id !== taxId)
      if (current.includes(taxId)) return current
      if (tax?.tipo === "IVA") {
        // One-IVA rule: picking an IVA replaces any other selected IVA.
        return [
          ...current.filter(
            (id) => taxes.find((t) => t.id === id)?.tipo !== "IVA",
          ),
          taxId,
        ]
      }
      return [...current, taxId]
    })
  }

  const clearIvas = () => {
    taxesTouchedRef.current = true
    setSelectedTaxIds((current) =>
      current.filter((id) => taxes.find((t) => t.id === id)?.tipo !== "IVA"),
    )
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
    setBarcodeError(false)
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
          setSelectedTaxIds([])
          taxesTouchedRef.current = false
          setBarcodeError(false)
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
                  <div className="grid grid-cols-2 gap-4">
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
                      <FormLabel>{t("products.netPrice")}</FormLabel>
                      <Input
                        type="number"
                        step="0.01"
                        value={netoDraft ?? chain.precioNeto.toFixed(2)}
                        onChange={(e) => handleNetoChange(e.target.value)}
                        onBlur={() => setNetoDraft(null)}
                      />
                    </FormItem>
                  </div>
                  <PriceChainPreview
                    costoActual={costo}
                    costoConImpuestos={chain.costoConImpuestos}
                    precioNeto={chain.precioNeto}
                    precioVenta={chain.precioVenta}
                  />
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
                  <FormField
                    control={form.control}
                    name="allow_price_edit_in_sale"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="allow-price-edit-checkbox"
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          {t("products.allowPriceEdit")}
                        </FormLabel>
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
                  {multipleIvas > 1 && (
                    <p className="text-sm text-destructive">
                      {t("errors.multiple_iva_taxes")}
                    </p>
                  )}
                  {/* Single-IVA picker (radio style): at most one tipo-IVA tax
                      per product, backend rule `multiple_iva_taxes`. */}
                  {ivaTaxes.length > 0 && (
                    <div
                      className={`flex items-center gap-2 text-sm border rounded px-2 py-1.5${selectedIvaId === null ? " bg-muted" : ""}`}
                      data-testid="no-iva-option"
                    >
                      <button
                        type="button"
                        onClick={clearIvas}
                        className="flex flex-1 items-center gap-2 text-left cursor-pointer"
                      >
                        <span
                          className={
                            "flex size-4 shrink-0 items-center justify-center rounded-full border " +
                            (selectedIvaId === null
                              ? "border-primary"
                              : "border-muted-foreground/50")
                          }
                        >
                          {selectedIvaId === null && (
                            <span className="size-2 rounded-full bg-primary" />
                          )}
                        </span>
                        {t("products.noIvaOption")}
                      </button>
                    </div>
                  )}
                  {ivaTaxes.map((tax) => {
                    const isChecked = selectedIvaId === tax.id
                    return (
                      <div
                        key={tax.id}
                        className="flex items-center gap-2 text-sm border rounded px-2 py-1.5"
                      >
                        <button
                          type="button"
                          data-testid={`iva-option-${tax.code}`}
                          onClick={() => toggleTax(tax.id, !isChecked)}
                          className="flex flex-1 items-center gap-2 text-left cursor-pointer"
                        >
                          <span
                            className={
                              "flex size-4 shrink-0 items-center justify-center rounded-full border " +
                              (isChecked
                                ? "border-primary"
                                : "border-muted-foreground/50")
                            }
                          >
                            {isChecked && (
                              <span className="size-2 rounded-full bg-primary" />
                            )}
                          </span>
                          {tax.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {tax.code}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                  {otherTaxes.map((tax) => {
                    const isChecked = selectedTaxIds.includes(tax.id)
                    return (
                      <div
                        key={tax.id}
                        className="flex items-center gap-2 text-sm border rounded px-2 py-1.5"
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(c) => toggleTax(tax.id, c === true)}
                        />
                        <button
                          type="button"
                          onClick={() => toggleTax(tax.id, !isChecked)}
                          className="flex-1 text-left cursor-pointer"
                        >
                          {tax.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {tax.code}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </TabsContent>

              <TabsContent value="barcodes">
                <div className="grid gap-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    {t("products.barcodesAddHint")}
                  </p>
                  {barcodeError && (
                    <p className="text-sm text-destructive">
                      {t("products.barcodeRequired")}
                    </p>
                  )}
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
                disabled={multipleIvas > 1}
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
