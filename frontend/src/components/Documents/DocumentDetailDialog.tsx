import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, FileCheck } from "lucide-react"
import { useState } from "react"

import type { DocumentPublic } from "@/client"
import {
  DocumentsService,
  PaymentMethodsService,
  ProductsService,
  TaxesService,
} from "@/client"
import VoidDocumentDialog from "@/components/Documents/VoidDocumentDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const money = (value: string | number) => `$${Number(value).toFixed(2)}`

interface DocumentDetailDialogProps {
  document: DocumentPublic | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DocumentDetailDialog = ({
  document,
  open,
  onOpenChange,
}: DocumentDetailDialogProps) => {
  const [voidOpen, setVoidOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const convertMutation = useMutation({
    mutationFn: (documentId: string) =>
      DocumentsService.convertToInvoice({ documentId }),
    onSuccess: (invoice) => {
      showSuccessToast(`Invoice ${invoice.numero} issued`)
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      onOpenChange(false)
    },
    onError: handleError.bind(showErrorToast),
  })

  const { data: productsData } = useQuery({
    queryFn: () => ProductsService.readProducts({ skip: 0, limit: 1000 }),
    queryKey: ["products"],
    enabled: open,
  })
  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 100 }),
    queryKey: ["payment-methods"],
    enabled: open,
  })
  const { data: taxesData } = useQuery({
    queryFn: () => TaxesService.readTaxes({ skip: 0, limit: 100 }),
    queryKey: ["taxes"],
    enabled: open,
  })

  if (!document) return null

  const voidable =
    document.estado === "active" &&
    !!document.document_type.void_document_type_id
  const convertible =
    document.estado === "active" &&
    document.document_type.operation === "cotizacion" &&
    !document.child_document_id

  const productNames = new Map(
    (productsData?.data ?? []).map((p) => [p.id, p.name] as const),
  )
  const methodNames = new Map(
    (methodsData?.data ?? []).map((m) => [m.id, m.name] as const),
  )
  const taxNames = new Map(
    (taxesData?.data ?? []).map((t) => [t.id, t.name] as const),
  )
  const lines = [...(document.lines ?? [])].sort((a, b) => a.orden - b.orden)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">{document.numero}</DialogTitle>
          <DialogDescription>
            {document.document_type.name} ·{" "}
            {new Date(document.fecha).toLocaleDateString("es-AR")} ·{" "}
            {document.contraparte_name ?? "No counterpart"} ·{" "}
            <span className="capitalize">{document.estado}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div>
            <h4 className="text-sm font-medium mb-2">Lines</h4>
            <ul className="divide-y rounded border">
              {lines.map((line) => (
                <li key={line.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex-1 truncate font-medium">
                      {productNames.get(line.product_id) ?? line.product_id}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {Number(line.cantidad)} × {money(line.precio_unit)}
                    </span>
                    <span className="font-mono whitespace-nowrap w-24 text-right">
                      {money(line.subtotal_line)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {Number(line.descuento_monto) > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        -{Number(line.descuento_pct)}%
                      </Badge>
                    )}
                    {(line.taxes ?? []).map((tax) => (
                      <Badge key={tax.id} variant="outline" className="text-xs">
                        {taxNames.get(tax.tax_id) ?? "Tax"} {money(tax.monto)}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {(document.taxes ?? []).length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">
                Document taxes (percepciones)
              </h4>
              <ul className="divide-y rounded border">
                {(document.taxes ?? []).map((tax) => (
                  <li
                    key={tax.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span>
                      {taxNames.get(tax.tax_id) ?? "Tax"}{" "}
                      <span className="text-muted-foreground">
                        · base {money(tax.base)}
                      </span>
                    </span>
                    <span className="font-mono">{money(tax.monto)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col items-end gap-1 rounded border p-3">
            <div className="flex w-64 justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono">{money(document.subtotal)}</span>
            </div>
            {Number(document.descuento_total) > 0 && (
              <div className="flex w-64 justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-mono">
                  -{money(document.descuento_total)}
                </span>
              </div>
            )}
            <div className="flex w-64 justify-between border-t pt-1 font-medium">
              <span>Total</span>
              <span className="font-mono">{money(document.total)}</span>
            </div>
          </div>

          {(document.payments ?? []).length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Payments</h4>
              <ul className="divide-y rounded border">
                {(document.payments ?? []).map((payment) => (
                  <li
                    key={payment.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span>
                      {methodNames.get(payment.payment_method_id) ??
                        payment.payment_method_id}
                    </span>
                    <span className="font-mono">{money(payment.monto)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {document.child_document_id && (
          <div className="flex items-center gap-2 rounded border bg-muted px-3 py-2 text-sm">
            <FileCheck className="h-4 w-4" />
            <span>
              Converted to{" "}
              <span className="font-mono">
                {document.child_document_numero}
              </span>
            </span>
          </div>
        )}
        {(voidable || convertible) && (
          <DialogFooter>
            {convertible && (
              <Button
                variant="outline"
                disabled={convertMutation.isPending}
                onClick={() => convertMutation.mutate(document.id)}
              >
                <FileCheck className="mr-2 h-4 w-4" />
                Convert to invoice
              </Button>
            )}
            {voidable && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setVoidOpen(true)}
              >
                <Ban className="mr-2 h-4 w-4" />
                Void document
              </Button>
            )}
          </DialogFooter>
        )}
        <VoidDocumentDialog
          document={document}
          open={voidOpen}
          onOpenChange={setVoidOpen}
          onVoided={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export default DocumentDetailDialog
