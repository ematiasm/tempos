import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Plus, Star, Trash2 } from "lucide-react"
import { useState } from "react"

import type { SupplierProductPublic } from "@/client"
import { SupplierProductsService, SuppliersService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

interface SupplierCostsTabProps {
  productId: string
  productName: string
}

const SupplierCostsTab = ({
  productId,
  productName,
}: SupplierCostsTabProps) => {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [newSupplierId, setNewSupplierId] = useState("")
  const [newCost, setNewCost] = useState("")
  const [newIsReference, setNewIsReference] = useState(false)
  const [newIsDefault, setNewIsDefault] = useState(false)
  const [editingCost, setEditingCost] = useState<{
    supplierId: string
    value: string
  } | null>(null)

  const { data: pairsData } = useQuery({
    queryFn: () =>
      SupplierProductsService.readSupplierProducts({
        productId,
        limit: 100,
      }),
    queryKey: ["supplier-products", productId],
  })
  const pairs = pairsData?.data ?? []

  const { data: suppliersData } = useQuery({
    queryFn: () => SuppliersService.readSuppliers({ limit: 100 }),
    queryKey: ["suppliers"],
  })
  const suppliers = suppliersData?.data ?? []

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["supplier-products", productId],
    })
    queryClient.invalidateQueries({ queryKey: ["products"] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      SupplierProductsService.createSupplierProduct({
        requestBody: {
          supplier_id: newSupplierId,
          product_id: productId,
          costo_actual: parseFloat(newCost) || 0,
          es_referencia: newIsReference || undefined,
          es_default: newIsDefault || undefined,
        },
      }),
    onSuccess: () => {
      showSuccessToast(t("products.supplierCostRegistered"))
      setNewSupplierId("")
      setNewCost("")
      setNewIsReference(false)
      setNewIsDefault(false)
      invalidate()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: {
      pair: SupplierProductPublic
      body: {
        costo_actual?: number
        es_referencia?: boolean
        es_default?: boolean
      }
    }) =>
      SupplierProductsService.updateSupplierProduct({
        supplierId: data.pair.supplier_id,
        productId: data.pair.product_id,
        requestBody: data.body,
      }),
    onSuccess: () => {
      showSuccessToast(t("products.supplierCostUpdated"))
      setEditingCost(null)
      invalidate()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (pair: SupplierProductPublic) =>
      SupplierProductsService.deleteSupplierProduct({
        supplierId: pair.supplier_id,
        productId: pair.product_id,
      }),
    onSuccess: () => {
      showSuccessToast(t("products.supplierCostRemoved"))
      invalidate()
    },
    onError: handleError.bind(showErrorToast),
  })

  const saveEditingCost = (pair: SupplierProductPublic) => {
    const value = parseFloat(editingCost?.value ?? "")
    if (editingCost && !Number.isNaN(value)) {
      updateMutation.mutate({ pair, body: { costo_actual: value } })
    }
  }

  const availableSuppliers = suppliers.filter(
    (s) => !pairs.some((p) => p.supplier_id === s.id),
  )

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-sm text-muted-foreground">
        {t("products.costsHint", { name: productName })}
      </p>

      {pairs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("products.noSupplierCosts")}
        </p>
      )}

      <ul className="divide-y rounded border">
        {pairs.map((pair) => {
          const isEditing = editingCost?.supplierId === pair.supplier_id
          return (
            <li
              key={pair.supplier_id}
              className="flex flex-col gap-2 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {pair.supplier_name}
                  </span>
                  {pair.es_referencia && (
                    <Badge className="gap-1">
                      <Star className="h-3 w-3" />
                      {t("products.reference")}
                    </Badge>
                  )}
                  {pair.es_default && (
                    <Badge variant="secondary">
                      <Check className="mr-1 h-3 w-3" />
                      {t("products.default")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox
                    checked={pair.es_referencia}
                    disabled={updateMutation.isPending}
                    onCheckedChange={(c) =>
                      updateMutation.mutate({
                        pair,
                        body: { es_referencia: c === true },
                      })
                    }
                  />
                  <span className="mr-2 text-xs text-muted-foreground">
                    {t("products.reference")}
                  </span>
                  <Checkbox
                    checked={pair.es_default}
                    disabled={updateMutation.isPending}
                    onCheckedChange={(c) =>
                      updateMutation.mutate({
                        pair,
                        body: { es_default: c === true },
                      })
                    }
                  />
                  <span className="mr-2 text-xs text-muted-foreground">
                    {t("products.default")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(pair)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {isEditing ? (
                  <>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 w-32"
                      value={editingCost?.value ?? ""}
                      onChange={(e) =>
                        setEditingCost({
                          supplierId: pair.supplier_id,
                          value: e.target.value,
                        })
                      }
                    />
                    <LoadingButton
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      loading={updateMutation.isPending}
                      onClick={() => saveEditingCost(pair)}
                    >
                      {t("common.save")}
                    </LoadingButton>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={() => setEditingCost(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-medium">${pair.costo_actual}</span>
                    {pair.costo_anterior !== "0.00" && (
                      <span className="text-xs text-muted-foreground line-through">
                        ${pair.costo_anterior}
                      </span>
                    )}
                    {pair.fecha_actualizacion && (
                      <span className="text-xs text-muted-foreground">
                        {t("products.updatedAt", {
                          date: new Date(
                            pair.fecha_actualizacion,
                          ).toLocaleDateString(),
                        })}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={() => {
                        setEditingCost({
                          supplierId: pair.supplier_id,
                          value: pair.costo_actual,
                        })
                      }}
                    >
                      {t("common.edit")}
                    </Button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {availableSuppliers.length > 0 && (
        <div className="mt-2 flex flex-col gap-3 rounded border p-3">
          <span className="text-sm font-medium">
            {t("products.registerSupplierCost")}
          </span>
          <Select value={newSupplierId} onValueChange={setNewSupplierId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("products.selectSupplier")} />
            </SelectTrigger>
            <SelectContent>
              {availableSuppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.razon_social}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            step="0.01"
            placeholder={t("products.costPerUnit")}
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={newIsReference}
                onCheckedChange={(c) => setNewIsReference(c === true)}
              />
              <span>{t("products.reference")}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={newIsDefault}
                onCheckedChange={(c) => setNewIsDefault(c === true)}
              />
              <span>{t("products.default")}</span>
            </div>
          </div>
          <LoadingButton
            type="button"
            variant="secondary"
            disabled={!newSupplierId || !newCost || createMutation.isPending}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("products.addSupplierCost")}
          </LoadingButton>
        </div>
      )}
    </div>
  )
}

export default SupplierCostsTab
