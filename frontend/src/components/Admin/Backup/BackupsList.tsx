import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DatabaseBackup, Download, RefreshCw, Trash2 } from "lucide-react"
import { useState } from "react"

import { type ApiError, type BackupPublic, BackupsService } from "@/client"
import { Badge } from "@/components/ui/badge"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useCustomToast from "@/hooks/useCustomToast"
import { useLocale, useT } from "@/i18n"
import { downloadBackup } from "@/lib/downloadBackup"
import { handleError } from "@/utils"

interface BackupsListProps {
  isRestoring: boolean
  onRestore: (backup: BackupPublic) => void
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function DeleteBackupDialog({
  backup,
  onSuccess,
}: {
  backup: BackupPublic
  onSuccess: () => void
}) {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => BackupsService.deleteBackup({ backupId: backup.id }),
    onSuccess: () => {
      showSuccessToast(t("admin.backups.deleted"))
      setIsOpen(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] })
    },
  })

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="ghost"
        size="icon"
        title={t("admin.backups.delete")}
        onClick={() => setIsOpen(true)}
      >
        <Trash2 className="h-4 w-4 text-red-500" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.backups.delete")}</DialogTitle>
          <DialogDescription>
            {t("admin.backups.deleteConfirm", { filename: backup.filename })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
          >
            {t("common.delete")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BackupsList({ isRestoring, onRestore }: BackupsListProps) {
  const t = useT()
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data: backups } = useQuery({
    queryFn: () => BackupsService.readBackups({ skip: 0, limit: 100 }),
    queryKey: ["backups"],
  })

  const createMutation = useMutation({
    mutationFn: () => BackupsService.createBackupNow(),
    onSuccess: (backup) => {
      if (backup.status === "failed") {
        showErrorToast(
          t("admin.backups.createFailed", { error: backup.error ?? "" }),
        )
      } else {
        showSuccessToast(t("admin.backups.created"))
      }
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] })
    },
  })

  const handleDownload = async (backup: BackupPublic) => {
    setDownloading(backup.id)
    try {
      await downloadBackup(backup.id, backup.filename)
    } catch (error) {
      handleError.bind(showErrorToast)(error as ApiError)
    } finally {
      setDownloading(null)
    }
  }

  if (!backups) {
    return <div className="text-muted-foreground">{t("common.loading")}</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.backups.list.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.backups.list.subtitle")}
          </p>
        </div>
        <LoadingButton
          onClick={() => createMutation.mutate()}
          loading={createMutation.isPending}
          disabled={isRestoring}
        >
          <RefreshCw className="h-4 w-4" />
          {createMutation.isPending
            ? t("admin.backups.creating")
            : t("admin.backups.createNow")}
        </LoadingButton>
      </div>

      {backups.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-12">
          <div className="rounded-full bg-muted p-4 mb-4">
            <DatabaseBackup className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">
            {t("admin.backups.list.title")}
          </h3>
          <p className="text-muted-foreground">{t("admin.backups.empty")}</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("common.date")}</TableHead>
              <TableHead>{t("admin.backups.kind")}</TableHead>
              <TableHead>{t("admin.backups.size")}</TableHead>
              <TableHead>{t("admin.backups.createdBy")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.data.map((backup) => (
              <TableRow key={backup.id}>
                <TableCell>
                  {backup.created_at
                    ? new Date(backup.created_at).toLocaleString(locale)
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {backup.kind === "scheduled"
                      ? t("admin.backups.kindScheduled")
                      : t("admin.backups.kindManual")}
                  </Badge>
                </TableCell>
                <TableCell>{formatSize(backup.size_bytes)}</TableCell>
                <TableCell>
                  {backup.created_by_name ?? t("admin.backups.system")}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      backup.status === "success" ? "secondary" : "destructive"
                    }
                  >
                    {backup.status === "success"
                      ? t("admin.backups.statusSuccess")
                      : t("admin.backups.statusFailed")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("admin.backups.download")}
                      disabled={isRestoring || downloading === backup.id}
                      onClick={() => handleDownload(backup)}
                    >
                      {downloading === backup.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("admin.backups.restore")}
                      disabled={isRestoring || backup.status === "failed"}
                      onClick={() => onRestore(backup)}
                    >
                      <DatabaseBackup className="h-4 w-4" />
                    </Button>
                    <DeleteBackupDialog
                      backup={backup}
                      onSuccess={() =>
                        queryClient.invalidateQueries({ queryKey: ["backups"] })
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export default BackupsList
