import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useState } from "react"

import type { ProductPublic } from "@/client"
import { ProductsService } from "@/client"
import BlockedByDocumentsDialog, {
  type DocumentRef,
  extractBlockedDocuments,
} from "@/components/Common/BlockedByDocumentsDialog"
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
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { handleError } from "@/utils"

interface DeleteProductProps {
  product: ProductPublic
  onSuccess: () => void
}

const DeleteProduct = ({ product, onSuccess }: DeleteProductProps) => {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [blockedDocuments, setBlockedDocuments] = useState<
    DocumentRef[] | null
  >(null)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deactivateMutation = useMutation({
    mutationFn: () =>
      ProductsService.updateProduct({
        productId: product.id,
        requestBody: { is_active: false },
      }),
    onSuccess: () => {
      showSuccessToast(t("products.deactivated"))
      setIsOpen(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => ProductsService.deleteProduct({ productId: product.id }),
    onSuccess: () => {
      showSuccessToast(t("products.deleted"))
      setIsDeleteOpen(false)
      onSuccess()
    },
    onError: (err) => {
      const docs = extractBlockedDocuments(err)
      if (docs) {
        setIsDeleteOpen(false)
        setBlockedDocuments(docs)
        return
      }
      handleError.bind(showErrorToast)(err as never)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })

  const deactivate = () => deactivateMutation.mutate()
  const deleteProduct = () => deleteMutation.mutate()

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="text-destructive"
          disabled={!product.is_active}
          onClick={() => setIsOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("products.deactivate")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setIsDeleteOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("products.delete")}
        </Button>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("products.deactivateTitle")}</DialogTitle>
            <DialogDescription>
              {t("products.deactivateHint", { name: product.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deactivateMutation.isPending}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={deactivateMutation.isPending}
              onClick={deactivate}
            >
              {t("products.deactivate")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("products.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("products.deleteHint", { name: product.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={deleteProduct}
            >
              {t("products.deleteConfirm")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BlockedByDocumentsDialog
        open={blockedDocuments !== null}
        onOpenChange={(open) => {
          if (!open) setBlockedDocuments(null)
        }}
        title={t("products.deleteBlockedTitle")}
        hint={t("products.deleteBlockedHint", {
          name: product.name,
          count: blockedDocuments?.length ?? 0,
        })}
        documents={blockedDocuments ?? []}
      />
    </>
  )
}

export default DeleteProduct
