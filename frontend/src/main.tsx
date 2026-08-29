import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { toast } from "sonner"
import { ApiError, OpenAPI } from "./client"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import { formatStatic, LocaleProvider } from "./i18n"
import "./index.css"
import { routeTree } from "./routeTree.gen"

OpenAPI.BASE = import.meta.env.VITE_API_URL
OpenAPI.TOKEN = async () => {
  return localStorage.getItem("access_token") || ""
}

// Queries: 401 = dead session → hard logout. 403 = missing permission (an
// expected response) → toast only, keep the session.
const handleQueryError = (error: Error) => {
  if (!(error instanceof ApiError)) return
  if (error.status === 401) {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
  } else if (error.status === 403) {
    toast.error(formatStatic("errors.not_enough_privileges"))
  }
}

// Mutations: 401 = dead session → hard logout. 403 is left to each mutation's
// local handleError toast, so we must not double-toast here.
const handleMutationError = (error: Error) => {
  if (error instanceof ApiError && error.status === 401) {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
  }
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleQueryError,
  }),
  mutationCache: new MutationCache({
    onError: handleMutationError,
  }),
})

const router = createRouter({ routeTree, context: { queryClient } })
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <RouterProvider router={router} />
          <Toaster richColors closeButton />
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
