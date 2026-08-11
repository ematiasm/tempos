import { TriangleAlert } from "lucide-react"

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
import { useT } from "@/i18n"

interface ConfirmRestoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string
  onConfirm: () => void
  isPending: boolean
}

function ConfirmRestoreDialog({
  open,
  onOpenChange,
  filename,
  onConfirm,
  isPending,
}: ConfirmRestoreDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-red-500" />
            {t("admin.backups.restore.confirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.backups.restore.confirmMessage", { filename })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            onClick={onConfirm}
            loading={isPending}
          >
            {t("admin.backups.restore.start")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmRestoreDialog
