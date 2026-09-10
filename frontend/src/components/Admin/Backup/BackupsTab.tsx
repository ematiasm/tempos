import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import {
  type BackupPublic,
  BackupsService,
  type Body_backups_restore_backup,
} from "@/client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { setupStatusQueryOptions } from "@/hooks/useSetupStatus"
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
  const { logout } = useAuth()
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)
  const restoreStartedRef = useRef(false)
  const restoreDoneRef = useRef(false)
  const preRestoreStartedAtRef = useRef<string | null | undefined>(undefined)

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
      restoreStartedRef.current = true
      // Remember the pre-restore state's timestamp so the success effect
      // below only fires for the restore started here (the state file keeps
      // the previous restore's success forever).
      preRestoreStartedAtRef.current =
        restoreStatusQuery.data?.started_at ?? null
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
  const restoreSucceeded = restoreStatus?.estado === "success"

  // After a restore started here succeeds, always return to login: the
  // session may belong to the wiped DB (its user row no longer exists), so
  // the user must continue with the restored database's users. The
  // started_at check keeps stale success states from previous restores from
  // firing this effect.
  useEffect(() => {
    if (
      !restoreSucceeded ||
      !restoreStartedRef.current ||
      restoreDoneRef.current ||
      restoreStatus?.started_at === preRestoreStartedAtRef.current
    )
      return
    restoreDoneRef.current = true
    // Drop the cached setup status: it may hold `setup_completed: false`
    // (30s staleTime) and would send the user back to the wizard right
    // after logging in with the restored database.
    queryClient.removeQueries({
      queryKey: setupStatusQueryOptions().queryKey,
    })
    showSuccessToast(t("setup.restoreDone"))
    logout()
  }, [
    restoreSucceeded,
    restoreStatus?.started_at,
    logout,
    queryClient,
    showSuccessToast,
    t,
  ])

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
