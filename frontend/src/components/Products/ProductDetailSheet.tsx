import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import type { ProductPublic, TaxPublic } from "@/client"
import {
  AttributesService,
  BusinessSettingsService,
  CategoriesService,
  ProductsService,
  TaxesService,
  UomsService,
} from "@/client"
import { buildCategoryRows } from "@/components/Admin/categoryColumns"
import DeleteProduct from "@/components/Products/DeleteProduct"
import SupplierCostsTab from "@/components/Products/SupplierCostsTab"
import { Badge } from "@/components/ui/badge"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

const detailsSchema = z.object({
  name: z.string().min(1, { message: "El nombre es obligatorio" }),
  sku: z.string().optional().or(z.literal("")),
  category_id: z.string().optional().or(z.literal("")),
  uom_id: z.string().min(1, { message: "La unidad es obligatoria" }),
  description: z.string().optional().or(z.literal("")),
  margen_pct: z.string().min(1, { message: "El margen es obligatorio" }),
  costo_actual: z.string().min(1, { message: "El costo es obligatorio" }),
  stock_minimo: z.string().optional().or(z.literal("")),
  stock_maximo: z.string().optional().or(z.literal("")),
  is_active: z.boolean(),
})

type DetailsFormData = z.infer<typeof detailsSchema>

interface ProductDetailSheetProps {
  product: ProductPublic | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ProductDetailSheet = ({
  product,
  open,
  onOpenChange,
}: ProductDetailSheetProps) => {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [newBarcode, setNewBarcode] = useState("")
  const [pendingTaxIds, setPendingTaxIds] = useState<Set<string>>(new Set())
  const [newVariantSuffix, setNewVariantSuffix] = useState("")
  const [newVariantValueIds, setNewVariantValueIds] = useState<string[]>([])

  const { data: categoriesData } = useQuery({
    queryFn: () => CategoriesService.readCategories({ skip: 0, limit: 100 }),
    queryKey: ["categories"],
    enabled: open,
  })
  const { data: uomsData } = useQuery({
    queryFn: () => UomsService.readUoms({ skip: 0, limit: 100 }),
    queryKey: ["uoms"],
    enabled: open,
  })
  const { data: taxesData } = useQuery({
    queryFn: () => TaxesService.readTaxes({ skip: 0, limit: 100 }),
    queryKey: ["taxes"],
    enabled: open,
  })
  const { data: settingsData } = useQuery({
    queryFn: () => BusinessSettingsService.readBusinessSettings(),
    queryKey: ["business-settings"],
    enabled: open,
  })
  const enableVariants = settingsData?.enable_variants ?? false

  const { data: attributesData } = useQuery({
    queryFn: () => AttributesService.readAttributes({ skip: 0, limit: 100 }),
    queryKey: ["attributes"],
    enabled: open && enableVariants,
  })
  const attributes = attributesData?.data ?? []

  const categories = categoriesData?.data ?? []
  const uoms = uomsData?.data ?? []
  const taxes = taxesData?.data ?? []

  const categoryRows = buildCategoryRows(categories)

  const form = useForm<DetailsFormData>({
    resolver: zodResolver(detailsSchema),
    mode: "onBlur",
    criteriaMode: "all",
  })

  useEffect(() => {
    if (!product) return
    form.reset({
      name: product.name,
      sku: product.sku ?? "",
      category_id: product.category_id ?? "",
      uom_id: product.uom_id,
      description: product.description ?? "",
      margen_pct: String(product.margen_pct),
      costo_actual: String(product.costo_actual),
      stock_minimo: product.stock_minimo ?? "",
      stock_maximo: product.stock_maximo ?? "",
      is_active: product.is_active,
    })
    setPendingTaxIds(new Set((product.taxes ?? []).map((t) => t.id)))
  }, [product, form])

  const costoStr = form.watch("costo_actual")
  const margenStr = form.watch("margen_pct")
  const costo = parseFloat(costoStr) || 0
  const margen = parseFloat(margenStr) || 0
  const precioPreview = (costo * (1 + margen / 100)).toFixed(2)

  const updateMutation = useMutation({
    mutationFn: (data: DetailsFormData) => {
      if (!product) throw new Error("No product")
      const requestBody: Record<string, unknown> = {
        name: data.name,
        sku: data.sku || null,
        category_id: data.category_id || null,
        uom_id: data.uom_id,
        description: data.description || null,
        margen_pct: parseFloat(data.margen_pct) || 0,
        costo_actual: parseFloat(data.costo_actual) || 0,
        is_active: data.is_active,
      }
      if (data.stock_minimo)
        requestBody.stock_minimo = parseFloat(data.stock_minimo)
      if (data.stock_maximo)
        requestBody.stock_maximo = parseFloat(data.stock_maximo)
      return ProductsService.updateProduct({
        productId: product.id,
        requestBody,
      })
    },
    onSuccess: () => {
      showSuccessToast(t("products.updated"))
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const saveTaxesMutation = useMutation({
    mutationFn: () => {
      if (!product) throw new Error("No product")
      return ProductsService.updateProduct({
        productId: product.id,
        requestBody: { tax_ids: Array.from(pendingTaxIds) },
      })
    },
    onSuccess: () => {
      showSuccessToast(t("products.taxesUpdated"))
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const addBarcodeMutation = useMutation({
    mutationFn: (code: string) => {
      if (!product) throw new Error("No product")
      return ProductsService.addBarcode({
        productId: product.id,
        requestBody: { code, product_id: product.id },
      })
    },
    onSuccess: () => {
      showSuccessToast(t("products.barcodeAdded"))
      setNewBarcode("")
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const deleteBarcodeMutation = useMutation({
    mutationFn: (barcodeId: string) =>
      ProductsService.deleteBarcode({ barcodeId }),
    onSuccess: () => {
      showSuccessToast(t("products.barcodeRemoved"))
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const createVariantMutation = useMutation({
    mutationFn: () => {
      if (!product) throw new Error("No product")
      return ProductsService.createVariant({
        productId: product.id,
        requestBody: {
          product_id: product.id,
          sku_suffix: newVariantSuffix.trim() || null,
          attribute_value_ids: newVariantValueIds,
        },
      })
    },
    onSuccess: () => {
      showSuccessToast(t("products.variantCreated"))
      setNewVariantSuffix("")
      setNewVariantValueIds([])
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const deleteVariantMutation = useMutation({
    mutationFn: (variantId: string) =>
      ProductsService.deleteVariant({ variantId }),
    onSuccess: () => {
      showSuccessToast(t("products.variantDeleted"))
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  if (!product) return null

  const toggleTax = (taxId: string, checked: boolean) => {
    setPendingTaxIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(taxId)
      else next.delete(taxId)
      return next
    })
  }

  const currentTaxIds = new Set((product.taxes ?? []).map((t) => t.id))
  const taxesDirty =
    pendingTaxIds.size !== currentTaxIds.size ||
    Array.from(pendingTaxIds).some((id) => !currentTaxIds.has(id))

  const barcodeList = product.barcodes ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">{product.name}</SheetTitle>
          <SheetDescription>
            {t("products.sheetHint", { sku: product.sku || "—" })}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList>
            <TabsTrigger value="details">{t("products.details")}</TabsTrigger>
            <TabsTrigger value="taxes">
              {t("products.taxes")} ({(product.taxes ?? []).length})
            </TabsTrigger>
            <TabsTrigger value="barcodes">
              {t("products.barcodes")} ({barcodeList.length})
            </TabsTrigger>
            <TabsTrigger value="costs">{t("products.costs")}</TabsTrigger>
            {enableVariants && (
              <TabsTrigger value="variants">
                {t("products.variants")} ({(product.variants ?? []).length})
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="details">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) =>
                  updateMutation.mutate(data),
                )}
                id="product-details-form"
              >
                <div className="grid gap-4 py-2">
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
                          <Input {...field} />
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
                            <Input {...field} />
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
                              {uoms.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.name} ({u.abbreviation})
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
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
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
                          {t("products.isActive")}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
                <SheetFooter className="flex justify-between sm:justify-between">
                  <DeleteProduct
                    product={product}
                    onSuccess={() => onOpenChange(false)}
                  />
                  <LoadingButton
                    type="submit"
                    form="product-details-form"
                    loading={updateMutation.isPending}
                  >
                    {t("products.saveChanges")}
                  </LoadingButton>
                </SheetFooter>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="taxes">
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm text-muted-foreground">
                {t("products.taxesToggleHint")}
              </p>
              {taxes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("products.noTaxes")}
                </p>
              )}
              {taxes.map((tax: TaxPublic) => {
                const isChecked = pendingTaxIds.has(tax.id)
                return (
                  <button
                    type="button"
                    key={tax.id}
                    onClick={() => toggleTax(tax.id, !isChecked)}
                    className={cn(
                      "flex items-center gap-3 cursor-pointer rounded border px-3 py-2 text-left w-full",
                      isChecked ? "bg-muted" : "",
                    )}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(c) => toggleTax(tax.id, c === true)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{tax.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {tax.tipo}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {tax.code} ·{" "}
                        {tax.is_percent
                          ? `${Number(tax.rate).toFixed(2)}%`
                          : `$${Number(tax.rate).toFixed(2)}`}
                      </span>
                    </div>
                  </button>
                )
              })}
              <SheetFooter>
                <LoadingButton
                  type="button"
                  disabled={!taxesDirty || saveTaxesMutation.isPending}
                  loading={saveTaxesMutation.isPending}
                  onClick={() => saveTaxesMutation.mutate()}
                >
                  {t("products.saveTaxes")}
                </LoadingButton>
              </SheetFooter>
            </div>
          </TabsContent>

          <TabsContent value="barcodes">
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm text-muted-foreground">
                {t("products.barcodesHint")}
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder={t("products.barcodePlaceholder")}
                  value={newBarcode}
                  onChange={(e) => setNewBarcode(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!newBarcode || addBarcodeMutation.isPending}
                  onClick={() => addBarcodeMutation.mutate(newBarcode)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {barcodeList.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("products.noBarcodesForProduct")}
                </p>
              )}
              <ul className="divide-y rounded border">
                {barcodeList.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="font-mono text-sm">{b.code}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={deleteBarcodeMutation.isPending}
                      onClick={() => deleteBarcodeMutation.mutate(b.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="costs">
            <SupplierCostsTab
              productId={product.id}
              productName={product.name}
            />
          </TabsContent>

          {enableVariants && (
            <TabsContent value="variants">
              <div className="flex flex-col gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  {t("products.variantsHint")}
                </p>

                <ul className="divide-y rounded border">
                  {(product.variants ?? []).map((variant) => (
                    <li
                      key={variant.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div className="flex flex-1 flex-wrap items-center gap-1.5">
                        {variant.sku_suffix && (
                          <Badge variant="secondary" className="font-mono">
                            {variant.sku_suffix}
                          </Badge>
                        )}
                        {(variant.attribute_values ?? []).map((av) => (
                          <Badge key={av.id} variant="outline">
                            {av.value}
                          </Badge>
                        ))}
                        <span className="text-xs text-muted-foreground ml-1">
                          {t("products.variantStock", {
                            stock: Number(variant.stock_current),
                          })}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={deleteVariantMutation.isPending}
                        onClick={() => deleteVariantMutation.mutate(variant.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
                {(product.variants ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("products.noVariants")}
                  </p>
                )}

                <div className="mt-2 flex flex-col gap-3 rounded border p-3">
                  <span className="text-sm font-medium">
                    {t("products.addVariant")}
                  </span>
                  <Input
                    placeholder={t("products.variantSuffixPlaceholder")}
                    value={newVariantSuffix}
                    onChange={(e) => setNewVariantSuffix(e.target.value)}
                  />
                  {attributes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("products.noAttributes")}
                    </p>
                  ) : (
                    attributes.map((attribute) => (
                      <div key={attribute.id} className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {attribute.name}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(attribute.values ?? []).map((av) => {
                            const selected = newVariantValueIds.includes(av.id)
                            return (
                              <button
                                type="button"
                                key={av.id}
                                onClick={() =>
                                  setNewVariantValueIds((prev) =>
                                    prev.includes(av.id)
                                      ? prev.filter((id) => id !== av.id)
                                      : [...prev, av.id],
                                  )
                                }
                                className={cn(
                                  "cursor-pointer rounded-full border px-2.5 py-0.5 text-xs",
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "hover:bg-muted",
                                )}
                              >
                                {av.value}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  )}
                  <LoadingButton
                    type="button"
                    variant="secondary"
                    loading={createVariantMutation.isPending}
                    onClick={() => createVariantMutation.mutate()}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t("products.addVariant")}
                  </LoadingButton>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

export default ProductDetailSheet
