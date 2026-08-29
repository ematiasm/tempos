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
  Wallet,
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
import { hasPermission } from "@/lib/permissions"
import { type Item, Main } from "./Main"
import { User } from "./User"

const baseItems: Item[] = [
  { icon: Home, titleKey: "nav.dashboard", path: "/" },
  {
    icon: ShoppingCart,
    titleKey: "nav.sell",
    path: "/sell",
    permission: "document.create",
  },
  {
    icon: ShoppingBasket,
    titleKey: "nav.buy",
    path: "/buy",
    permission: "document.create",
  },
  {
    icon: Boxes,
    titleKey: "nav.stock",
    path: "/stock",
    permission: "stock.read",
  },
  {
    icon: Package,
    titleKey: "nav.products",
    path: "/catalog/products",
    permission: "product.read",
  },
  {
    icon: UserRound,
    titleKey: "nav.customers",
    path: "/customers",
    permission: "customer.read",
  },
  {
    icon: Truck,
    titleKey: "nav.suppliers",
    path: "/suppliers",
    permission: "supplier.read",
  },
  {
    icon: FileText,
    titleKey: "nav.documents",
    path: "/documents",
    permission: "document.read",
  },
  {
    icon: HandCoins,
    titleKey: "nav.payments",
    path: "/payments",
    permission: "payment.read",
  },
  {
    icon: Wallet,
    titleKey: "nav.finance",
    path: "/finance",
    permission: "finance.read",
  },
  {
    icon: BarChart3,
    titleKey: "nav.reports",
    path: "/reports",
    permission: "report.view",
  },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()

  // Items without a permission are always visible; the rest are filtered by
  // the current user's permissions (superusers pass every check). While the
  // me-query resolves currentUser is undefined, so the sidebar starts empty.
  const items: Item[] = [
    ...baseItems.filter(
      (item) => !item.permission || hasPermission(currentUser, item.permission),
    ),
  ]
  if (currentUser?.is_superuser) {
    items.push({ icon: Users, titleKey: "nav.admin", path: "/admin" })
  }

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
