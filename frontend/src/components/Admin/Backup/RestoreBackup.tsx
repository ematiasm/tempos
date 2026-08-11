import { FileUp, Loader2 } from "lucide-react"
import { type ChangeEvent, useRef, useState } from "react"

import type { RestoreStatusPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { useLocale, useT } from "@/i18n"

interface RestoreBackupProps {
  restoreStatus?: RestoreStatusPublic
  statusError: boolean
  isRestoring: boolean
  isPending: boolean
  onRestore: (file: File) => void
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function RestoreBackup({
  restoreStatus,
  statusError,
  isRestoring,
  isPending,
  onRestore,
}: RestoreBackupProps) {
  const t = useT()
  const { locale } = useLocale()
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
  }

  const status = restoreStatus?.estado ?? "idle"

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          {t("admin.backups.restore.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("admin.backups.restore.subtitle")}
        </p>
      </div>

      {statusError && (
        <div className="rounded-md border border-orange-500/50 bg-orange-500/10 p-4 text-sm text-orange-600">
          <span className="font-medium">
            {t("admin.backups.restore.unreachable")}
          </span>
        </div>
      )}

      {status === "running" && (
        <div className="flex items-center gap-2 rounded-md border border-blue-500/50 bg-blue-500/10 p-4 text-sm text-blue-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              {t("admin.backups.restore.running")}
            </span>
            {restoreStatus?.source_filename && (
              <span className="text-blue-600/70">
                {restoreStatus.source_filename}
              </span>
            )}
          </div>
        </div>
      )}

      {status === "failed" && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-600">
          <span className="font-medium">
            {t("admin.backups.restore.failed", {
              error: restoreStatus?.error ?? "",
            })}
          </span>
        </div>
      )}

      {status === "success" && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 p-4 text-sm text-green-600">
          <span className="font-medium">
            {t("admin.backups.restore.success")}
          </span>
          {restoreStatus?.finished_at && (
            <span className="ml-2 text-green-600/70">
              {new Date(restoreStatus.finished_at).toLocaleString(locale)}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <div className="flex items-center gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={isRestoring || isPending}
          >
            <FileUp className="h-4 w-4" />
            {t("admin.backups.restore.upload")}
          </Button>
          <Input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".dump,.sql,application/octet-stream"
            onChange={handleChange}
            disabled={isRestoring || isPending}
          />
          <span className="truncate text-sm text-muted-foreground">
            {file
              ? `${file.name} (${formatSize(file.size)})`
              : t("admin.backups.restore.noFile")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("admin.backups.restore.fileHint")}
        </p>
        <LoadingButton
          onClick={() => file && onRestore(file)}
          disabled={!file || isRestoring}
          loading={isPending}
        >
          {t("admin.backups.restore.start")}
        </LoadingButton>
      </div>
    </div>
  )
}

export default RestoreBackup
