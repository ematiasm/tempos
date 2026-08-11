import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  type BackupPublic,
  BackupsService,
  type Body_backups_restore_backup,
} from "@/client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"
import { useT } from "@/i18n"
import { handleError } from "@/utils"
import BackupScheduleForm from "./BackupScheduleForm"
import BackupsList from "./BackupsList"
import ConfirmRestoreDialog from "./ConfirmRestoreDialog"
import RestoreBackup from "./RestoreBackup"

type RestoreTarget = {
  filename: string
  payload: { file?: File; backupId?: string }
}

function BackupsTab() {
  const t = useT()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)

  const restoreStatusQuery = useQuery({
    queryKey: ["restore-status"],
    queryFn: () => BackupsService.readRestoreStatus(),
    refetchInterval: (query) =>
      query.state.data?.estado === "running" ? 3000 : false,
  })

  const restoreMutation = useMutation({
    mutationFn: async (payload: RestoreTarget["payload"]) => {
      const formData: Body_backups_restore_backup = {}
      if (payload.file) {
        formData.file = payload.file as unknown as string
      }
      if (payload.backupId) {
        formData.backup_id = payload.backupId
      }
      return BackupsService.restoreBackup({ formData })
    },
    onSuccess: () => {
      showSuccessToast(t("admin.backups.restore.started"))
      setRestoreTarget(null)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["restore-status"] })
      queryClient.invalidateQueries({ queryKey: ["backups"] })
    },
  })

  const restoreStatus = restoreStatusQuery.data
  const isRestoring = restoreStatus?.estado === "running"

  const handleRestoreBackup = (backup: BackupPublic) => {
    setRestoreTarget({
      filename: backup.filename,
      payload: { backupId: backup.id },
    })
  }

  const handleRestoreFile = (file: File) => {
    setRestoreTarget({ filename: file.name, payload: { file } })
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">
            {t("admin.backups.tabSchedule")}
          </TabsTrigger>
          <TabsTrigger value="backups">
            {t("admin.backups.tabList")}
          </TabsTrigger>
          <TabsTrigger value="restore">
            {t("admin.backups.tabRestore")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <BackupScheduleForm />
        </TabsContent>
        <TabsContent value="backups">
          <BackupsList
            isRestoring={isRestoring}
            onRestore={handleRestoreBackup}
          />
        </TabsContent>
        <TabsContent value="restore">
          <RestoreBackup
            restoreStatus={restoreStatus}
            statusError={restoreStatusQuery.isError}
            isRestoring={isRestoring}
            isPending={restoreMutation.isPending}
            onRestore={handleRestoreFile}
          />
        </TabsContent>
      </Tabs>

      <ConfirmRestoreDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        filename={restoreTarget?.filename ?? ""}
        isPending={restoreMutation.isPending}
        onConfirm={() =>
          restoreTarget && restoreMutation.mutate(restoreTarget.payload)
        }
      />
    </div>
  )
}

export default BackupsTab
