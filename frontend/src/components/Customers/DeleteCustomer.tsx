import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useState } from "react"

import type { CustomerPublic } from "@/client"
import { CustomersService } from "@/client"
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

interface DeleteCustomerProps {
  customer: CustomerPublic
  onSuccess: () => void
}

const DeleteCustomer = ({ customer, onSuccess }: DeleteCustomerProps) => {
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
      CustomersService.updateCustomer({
        customerId: customer.id,
        requestBody: { is_active: false },
      }),
    onSuccess: () => {
      showSuccessToast(t("customers.deactivated"))
      setIsOpen(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      CustomersService.deleteCustomer({ customerId: customer.id }),
    onSuccess: () => {
      showSuccessToast(t("customers.deleted"))
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
      queryClient.invalidateQueries({ queryKey: ["customers"] })
    },
  })

  const deactivate = () => deactivateMutation.mutate()
  const deleteCustomer = () => deleteMutation.mutate()

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => e.preventDefault()}
          onClick={() => setIsOpen(true)}
        >
          <Trash2 />
          {t("customers.deactivate")}
        </DropdownMenuItem>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("customers.deactivateTitle")}</DialogTitle>
            <DialogDescription>
              {t("customers.deactivateHint", {
                name: customer.razon_social,
              })}
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
              {t("customers.deactivateAction")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => e.preventDefault()}
          onClick={() => setIsDeleteOpen(true)}
        >
          <Trash2 />
          {t("customers.delete")}
        </DropdownMenuItem>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("customers.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("customers.deleteHint", {
                name: customer.razon_social,
              })}
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
              onClick={deleteCustomer}
            >
              {t("customers.deleteConfirm")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BlockedByDocumentsDialog
        open={blockedDocuments !== null}
        onOpenChange={(open) => {
          if (!open) setBlockedDocuments(null)
        }}
        title={t("customers.deleteBlockedTitle")}
        hint={t("customers.deleteBlockedHint", {
          name: customer.razon_social,
          count: blockedDocuments?.length ?? 0,
        })}
        documents={blockedDocuments ?? []}
      />
    </>
  )
}

export default DeleteCustomer
