import {
  BarChart3,
  Boxes,
  FileText,
  HandCoins,
  Home,
  Package,
  ShoppingBasket,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
} from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User } from "./User"

const baseItems: Item[] = [
  { icon: Home, titleKey: "nav.dashboard", path: "/" },
  { icon: ShoppingCart, titleKey: "nav.sell", path: "/sell" },
  { icon: ShoppingBasket, titleKey: "nav.buy", path: "/buy" },
  { icon: Boxes, titleKey: "nav.stock", path: "/stock" },
  { icon: Package, titleKey: "nav.products", path: "/catalog/products" },
  { icon: UserRound, titleKey: "nav.customers", path: "/customers" },
  { icon: Truck, titleKey: "nav.suppliers", path: "/suppliers" },
  { icon: FileText, titleKey: "nav.documents", path: "/documents" },
  { icon: HandCoins, titleKey: "nav.payments", path: "/payments" },
  { icon: BarChart3, titleKey: "nav.reports", path: "/reports" },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()

  const items: Item[] = currentUser?.is_superuser
    ? [...baseItems, { icon: Users, titleKey: "nav.admin", path: "/admin" }]
    : baseItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
