import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { ApiError } from "@/client"
import { Footer } from "@/components/Common/Footer"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { setupStatusQueryOptions } from "@/hooks/useSetupStatus"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async ({ context }) => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
    let setupCompleted: boolean
    try {
      const status = await context.queryClient.ensureQueryData(
        setupStatusQueryOptions(),
      )
      setupCompleted = status.setup_completed
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({ to: "/login" })
      }
      // Fail open on other errors (e.g. network): the /setup route re-checks
      // the status and its submit surfaces the real API error.
      return
    }
    if (!setupCompleted) {
      throw redirect({ to: "/setup" })
    }
  },
})

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
        </header>
        <main className="flex-1 p-6 md:p-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  )
}
