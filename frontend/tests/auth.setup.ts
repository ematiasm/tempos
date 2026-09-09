import { test as setup } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { api } from "./utils/api"

const authFile = "playwright/.auth/user.json"

setup("authenticate", async ({ page, request }) => {
  // Complete the first-run setup on a fresh database: the layout guard
  // redirects every page to /setup while no BusinessSettings row exists
  // (POST /setup is idempotent-guarded and returns 409 when already done).
  const status = await api.getOne<{ setup_completed: boolean }>(
    request,
    "/setup/status",
  )
  if (!status.setup_completed) {
    await api.post(request, "/setup/", {
      business_name: "tempos E2E",
      condicion_fiscal: "Consumidor Final",
      default_locale: "es",
    })
  } else {
    // The suite is written against the Spanish UI; the backend pytest
    // restore leaves default_locale = en, so pin it for determinism.
    await api.patch(request, "/business-settings/", { default_locale: "es" })
  }
  await page.goto("/login")
  await page.getByTestId("email-input").fill(firstSuperuser)
  await page.getByTestId("password-input").fill(firstSuperuserPassword)
  await page.getByRole("button", { name: "Iniciar sesión" }).click()
  await page.waitForURL("/")
  await page.context().storageState({ path: authFile })
})
