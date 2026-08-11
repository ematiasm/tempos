import { createFileRoute } from "@tanstack/react-router"
import type { ComponentType } from "react"

import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import LanguageSettings from "@/components/UserSettings/LanguageSettings"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import { formatStatic, type MessageId, useT } from "@/i18n"

const tabsConfig: {
  value: string
  title: MessageId
  component: ComponentType
}[] = [
  {
    value: "my-profile",
    title: "settings.tabProfile",
    component: UserInformation,
  },
  {
    value: "password",
    title: "settings.tabPassword",
    component: ChangePassword,
  },
  {
    value: "danger-zone",
    title: "settings.tabDangerZone",
    component: DeleteAccount,
  },
  {
    value: "language",
    title: "settings.tabLanguage",
    component: LanguageSettings,
  },
]

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [
      {
        title: `${formatStatic("settings.title")} - tempos`,
      },
    ],
  }),
})

function UserSettings() {
  const t = useT()
  const { user: currentUser } = useAuth()
  const finalTabs = currentUser?.is_superuser
    ? tabsConfig.slice(0, 3)
    : tabsConfig

  if (!currentUser) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Tabs defaultValue="my-profile">
        <TabsList>
          {finalTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.title)}
            </TabsTrigger>
          ))}
        </TabsList>
        {finalTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
