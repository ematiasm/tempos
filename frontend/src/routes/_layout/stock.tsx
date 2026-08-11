import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CheckCircle2, Trash2 } from "lucide-react"
import { useState } from "react"

import type { ProductPublic, ProductVariantPublic } from "@/client"
import { DocumentsService, DocumentTypesService } from "@/client"
import ProductSearch from "@/components/Sell/ProductSearch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { formatStatic, useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/stock")({
  component: Stock,
  head: () => ({
    meta: [{ title: `${formatStatic("stock.title")} - tempos` }],
  }),
})

const round2 = (n: number) => Math.round(n * 1000) / 1000

interface AdjustLine {
  product: ProductPublic
  variant?: ProductVariantPublic
  qty: number
}

function Stock() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const t = useT()

  const { data: typesData } = useQuery({
    queryFn: () =>
      DocumentTypesService.readDocumentTypes({ skip: 0, limit: 100 }),
    queryKey: ["document-types"],
  })
  const ajsType = typesData?.data.find(
    (t) => t.operation === "ajuste" && t.prefix === "AJS",
  )

  const [lines, setLines] = useState<AdjustLine[]>([])
  const [motivo, setMotivo] = useState("")
  const [done, setDone] = useState<string | null>(null)

  const addLine = (product: ProductPublic, variant?: ProductVariantPublic) => {
    const existing = lines.find(
      (l) =>
        l.product.id === product.id &&
        (l.variant?.id ?? null) === (variant?.id ?? null),
    )
    if (existing) {
      setLines((prev) =>
        prev.map((l) =>
          l === existing ? { ...l, qty: round2(l.qty + 1) } : l,
        ),
      )
    } else {
      setLines([...lines, { product, variant, qty: 1 }])
    }
  }

  const updateQty = (index: number, qty: number) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, qty } : l)))
  }

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const adjustMutation = useMutation({
    mutationFn: () => {
      if (!ajsType) throw new Error("Ajuste Stock type not found")
      return DocumentsService.createDocument({
        requestBody: {
          document_type_id: ajsType.id,
          contraparte_id: null,
          lines: lines.map((l) => ({
            product_id: l.product.id,
            variant_id: l.variant?.id ?? null,
            cantidad: l.qty,
          })),
          payments: [],
        },
      })
    },
    onSuccess: (doc) => {
      showSuccessToast(t("stock.adjusted", { numero: doc.numero }))
      setDone(doc.numero)
      setLines([])
      setMotivo("")
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const isPositive = lines.length > 0 && lines.every((l) => l.qty > 0)
  const isNegative = lines.length > 0 && lines.every((l) => l.qty < 0)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("stock.title")}
        </h1>
        <p className="text-muted-foreground">{t("stock.subtitle")}</p>
      </div>

      {done ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <div>
            <h2 className="text-lg font-semibold">{done}</h2>
            <p className="text-muted-foreground">{t("stock.adjustedOk")}</p>
          </div>
          <Button onClick={() => setDone(null)}>
            {t("stock.newAdjustment")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="flex flex-col gap-4">
            <ProductSearch onAdd={addLine} />
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("stock.emptyHint")}
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{t("stock.product")}</th>
                      <th className="px-2 py-2 text-right">
                        {t("stock.currentStock")}
                      </th>
                      <th className="w-32 px-2 py-2 text-right">
                        {t("stock.adjustment")}
                      </th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((line, index) => {
                      const current = line.variant
                        ? Number(line.variant.stock_current)
                        : Number(line.product.stock_current)
                      const after = round2(current + line.qty)
                      const invalid = after < 0
                      return (
                        <tr
                          key={`${line.product.id}-${line.variant?.id ?? "base"}`}
                        >
                          <td className="px-3 py-2">
                            <span className="font-medium">
                              {line.product.name}
                            </span>
                            {line.variant && (
                              <div className="flex gap-1">
                                {line.variant.sku_suffix && (
                                  <Badge
                                    variant="secondary"
                                    className="font-mono text-[10px]"
                                  >
                                    {line.variant.sku_suffix}
                                  </Badge>
                                )}
                                {(line.variant.attribute_values ?? []).map(
                                  (av) => (
                                    <Badge
                                      key={av.id}
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {av.value}
                                    </Badge>
                                  ),
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {current}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <Input
                              type="number"
                              step="0.001"
                              className={cn(
                                "ml-auto h-8 w-28 text-right",
                                line.qty > 0 && "text-emerald-600",
                                line.qty < 0 && "text-red-600",
                              )}
                              value={line.qty}
                              onChange={(e) =>
                                updateQty(index, Number(e.target.value) || 0)
                              }
                            />
                            <p
                              className={cn(
                                "mt-1 text-xs",
                                invalid
                                  ? "text-red-600"
                                  : "text-muted-foreground",
                              )}
                            >
                              {t("stock.after", { after })}
                            </p>
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeLine(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {isPositive && (
              <p className="text-xs text-muted-foreground">
                {t("stock.positiveTip")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("stock.reason")}
              </span>
              <Input
                placeholder={t("stock.reasonPlaceholder")}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <LoadingButton
                className="flex-1"
                variant="destructive"
                loading={adjustMutation.isPending}
                disabled={!isNegative || !ajsType}
                onClick={() => adjustMutation.mutate()}
              >
                {t("stock.removeStock", { count: lines.length })}
              </LoadingButton>
              <LoadingButton
                className="flex-1"
                loading={adjustMutation.isPending}
                disabled={!isPositive || !ajsType}
                onClick={() => adjustMutation.mutate()}
              >
                {t("stock.addStock", { count: lines.length })}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Stock
