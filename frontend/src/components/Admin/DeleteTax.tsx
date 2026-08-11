import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useState } from "react"

import type { TaxPublic } from "@/client"
import { TaxesService } from "@/client"
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { handleError } from "@/utils"

interface DeleteTaxProps {
  tax: TaxPublic
  onSuccess: () => void
}

const DeleteTax = ({ tax, onSuccess }: DeleteTaxProps) => {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [blockedDocuments, setBlockedDocuments] = useState<
    DocumentRef[] | null
  >(null)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => TaxesService.deleteTax({ taxId: tax.id }),
    onSuccess: () => {
      showSuccessToast(t("admin.taxes.deleted"))
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

  const deleteTax = () => mutation.mutate()

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => e.preventDefault()}
          onClick={() => setIsOpen(true)}
        >
          <Trash2 />
          {t("admin.taxes.delete")}
        </DropdownMenuItem>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.taxes.delete")}</DialogTitle>
            <DialogDescription>
              {t("admin.taxes.deleteConfirm", {
                name: tax.name,
                code: tax.code,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={mutation.isPending}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={mutation.isPending}
              onClick={deleteTax}
            >
              {t("common.delete")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BlockedByDocumentsDialog
        open={blockedDocuments !== null}
        onOpenChange={(open) => {
          if (!open) setBlockedDocuments(null)
        }}
        title={t("admin.taxes.deleteBlockedTitle")}
        hint={t("admin.taxes.deleteBlockedHint", {
          name: tax.name,
          count: blockedDocuments?.length ?? 0,
        })}
        documents={blockedDocuments ?? []}
      />
    </>
  )
}

export default DeleteTax
