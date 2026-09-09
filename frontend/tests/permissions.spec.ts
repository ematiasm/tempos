import { expect, test } from "@playwright/test"

import { api } from "./utils/api"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

/**
 * Restricted-user permission flow: a user with a limited role sees only the
 * sidebar sections their permissions allow, keeps their session when they
 * navigate to a panel they lack permissions for (queries are permission-gated
 * so they never fire: empty states, no 403 toast, no logout), and can still
 * use the panels they do have access to.
 */
test("restricted user keeps session and gets a filtered sidebar", async ({
  page,
  request,
}) => {
  // Arrange: a role limited to product + customer reads, and a user with it.
  const permissions = await api
    .get<{ id: string; code: string }>(
      request,
      "/permissions/?skip=0&limit=1000",
    )
    .then((r) => r.data)
  const permissionIds = permissions
    .filter((p) => ["product.read", "customer.read"].includes(p.code))
    .map((p) => p.id)
  expect(permissionIds).toHaveLength(2)

  const role = await api.post<{ id: string }>(request, "/roles/", {
    name: `Restricted ${Math.random().toString(36).substring(7)}`,
    description: "E2E restricted role",
    permission_ids: permissionIds,
  })

  const email = randomEmail()
  const password = `${randomPassword()}P4ssw0rd`
  await api.post(request, "/users/", {
    email,
    password,
    is_active: true,
    is_superuser: false,
    full_name: "Restricted E2E User",
    role_ids: [role.id],
  })

  // Log in as the restricted user through the UI.
  await logInUser(page, email, password)

  // Sidebar shows only allowed sections: products yes, finance/reports no.
  await expect(page.getByRole("link", { name: "Productos" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Finanzas" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Reportes" })).toHaveCount(0)

  // Direct navigation to a forbidden panel: the panel's data queries are
  // gated on the panel permission, so they do not fire at all — the page
  // renders with empty states, no 403 toast appears, and the session
  // survives (no redirect to /login).
  await page.goto("/finance")
  await expect(page).toHaveURL(/\/finance$/)
  await expect(page.getByRole("heading", { name: "Finanzas" })).toBeVisible()
  await expect(
    page.getByText("No tenés permisos para realizar esta acción"),
  ).toHaveCount(0)
  await expect(page.getByTestId("user-menu")).toBeVisible()

  // An allowed panel loads normally.
  await page.goto("/catalog/products")
  await expect(page).toHaveURL(/\/catalog\/products$/)
  await expect(page.getByRole("heading", { name: "Productos" })).toBeVisible()

  // Cleanup: leftover roles accumulate in the shared dev DB and bloat the
  // Admin user dialog (its footer falls out of the viewport).
  const users = await api
    .get<{ id: string; email: string }>(request, "/users/?skip=0&limit=1000")
    .then((r) => r.data)
  for (const u of users) {
    if (u.email === email) await api.delete(request, `/users/${u.id}`)
  }
  await api.delete(request, `/roles/${role.id}`)
})
