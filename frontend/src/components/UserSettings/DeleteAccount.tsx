import { useT } from "@/i18n"

import DeleteConfirmation from "./DeleteConfirmation"

const DeleteAccount = () => {
  const t = useT()
  return (
    <div className="max-w-md mt-4 rounded-lg border border-destructive/50 p-4">
      <h3 className="font-semibold text-destructive">
        {t("settings.deleteAccountTitle")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("settings.deleteAccountHint")}
      </p>
      <DeleteConfirmation />
    </div>
  )
}

export default DeleteAccount
