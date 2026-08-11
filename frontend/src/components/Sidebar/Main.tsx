import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { type MessageId, useT } from "@/i18n"

export type Item = {
  icon: LucideIcon
  titleKey: MessageId
  path: string
}

interface MainProps {
  items: Item[]
}

export function Main({ items }: MainProps) {
  const t = useT()
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouterState()
  const currentPath = router.location.pathname

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const title = t(item.titleKey)
            const isActive = currentPath === item.path

            return (
              <SidebarMenuItem key={item.titleKey}>
                <SidebarMenuButton tooltip={title} isActive={isActive} asChild>
                  <RouterLink to={item.path} onClick={handleMenuClick}>
                    <item.icon />
                    <span>{title}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
