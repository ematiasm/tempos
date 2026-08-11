import { createFileRoute } from "@tanstack/react-router"

import useAuth from "@/hooks/useAuth"
import { formatStatic, useT } from "@/i18n"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [{ title: `${formatStatic("nav.dashboard")} - tempos` }],
  }),
})

function Dashboard() {
  const t = useT()
  const { user: currentUser } = useAuth()

  return (
    <div>
      <div>
        <h1 className="text-2xl truncate max-w-sm">
          {t("dashboard.greeting", {
            name: currentUser?.full_name || currentUser?.email || "",
          })}
        </h1>
        <p className="text-muted-foreground">{t("dashboard.welcome")}</p>
      </div>
    </div>
  )
}
