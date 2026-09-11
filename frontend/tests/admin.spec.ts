import { expect, type Page, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { api } from "./utils/api"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

const gotoAdminUsers = async (page: Page) => {
  await page.goto("/admin")
  await page.getByRole("tab", { name: "Usuarios y Roles" }).click()
}

test("Admin page is accessible and shows correct title", async ({ page }) => {
  await gotoAdminUsers(page)
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible()
  await expect(
    page.getByText(
      "Administrá las cuentas de usuario y la asignación de roles",
    ),
  ).toBeVisible()
})

test("Add User button is visible", async ({ page }) => {
  await gotoAdminUsers(page)
  await expect(
    page.getByRole("button", { name: "Agregar usuario" }),
  ).toBeVisible()
})

test.describe("Admin user management", () => {
  test("Create a new user successfully", async ({ page, request }) => {
    await gotoAdminUsers(page)

    const email = randomEmail()
    const password = randomPassword()
    const fullName = "Test User Admin"

    await page.getByRole("button", { name: "Agregar usuario" }).click()

    await page.getByPlaceholder("Correo").fill(email)
    await page.getByPlaceholder("Nombre completo").fill(fullName)
    await page.getByPlaceholder("Contraseña").first().fill(password)
    await page.getByPlaceholder("Contraseña").last().fill(password)

    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(page.getByText("Usuario creado correctamente")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await expect(userRow).toBeVisible()

    // cleanup: leftover users accumulate in the shared dev DB and break
    // getByText uniqueness in later runs
    const users = await api
      .get<{ id: string; email: string; full_name?: string | null }>(
        request,
        "/users/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    for (const u of users) {
      if (u.email === email) await api.delete(request, `/users/${u.id}`)
    }
  })

  test("Create a superuser", async ({ page, request }) => {
    await gotoAdminUsers(page)

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "Agregar usuario" }).click()

    await page.getByPlaceholder("Correo").fill(email)
    await page.getByPlaceholder("Contraseña").first().fill(password)
    await page.getByPlaceholder("Contraseña").last().fill(password)
    await page.getByLabel("¿Es superusuario?").check()
    await page.getByLabel("¿Está activo?").check()

    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(page.getByText("Usuario creado correctamente")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await expect(userRow.getByText("Superusuario")).toBeVisible()

    // cleanup: leftover users accumulate in the shared dev DB and break
    // getByText uniqueness in later runs
    const users = await api
      .get<{ id: string; email: string; full_name?: string | null }>(
        request,
        "/users/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    for (const u of users) {
      if (u.email === email) await api.delete(request, `/users/${u.id}`)
    }
  })

  test("Edit a user successfully", async ({ page, request }) => {
    await gotoAdminUsers(page)

    const email = randomEmail()
    const password = randomPassword()
    const originalName = "Original Name"
    const updatedName = "Updated Name"

    await page.getByRole("button", { name: "Agregar usuario" }).click()
    await page.getByPlaceholder("Correo").fill(email)
    await page.getByPlaceholder("Nombre completo").fill(originalName)
    await page.getByPlaceholder("Contraseña").first().fill(password)
    await page.getByPlaceholder("Contraseña").last().fill(password)
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(page.getByText("Usuario creado correctamente")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "Editar usuario" }).click()

    await page.getByPlaceholder("Nombre completo").fill(updatedName)
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(
      page.getByText("Usuario actualizado correctamente"),
    ).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()

    // cleanup: leftover users accumulate in the shared dev DB and break
    // getByText uniqueness in later runs
    const users = await api
      .get<{ id: string; email: string; full_name?: string | null }>(
        request,
        "/users/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    for (const u of users) {
      if (u.email === email || u.full_name === updatedName)
        await api.delete(request, `/users/${u.id}`)
    }
  })

  test("Delete a user successfully", async ({ page }) => {
    await gotoAdminUsers(page)

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "Agregar usuario" }).click()
    await page.getByPlaceholder("Correo").fill(email)
    await page.getByPlaceholder("Contraseña").first().fill(password)
    await page.getByPlaceholder("Contraseña").last().fill(password)
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(page.getByText("Usuario creado correctamente")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "Eliminar usuario" }).click()

    await page.getByRole("button", { name: "Eliminar" }).click()

    await expect(
      page.getByText("El usuario se eliminó correctamente"),
    ).toBeVisible()

    await expect(
      page.getByRole("row").filter({ hasText: email }),
    ).not.toBeVisible()
  })

  test("Cancel user creation", async ({ page }) => {
    await gotoAdminUsers(page)

    await page.getByRole("button", { name: "Agregar usuario" }).click()
    await page.getByPlaceholder("Correo").fill("test@example.com")

    await page.getByRole("button", { name: "Cancelar" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("Email is required and must be valid", async ({ page }) => {
    await gotoAdminUsers(page)

    await page.getByRole("button", { name: "Agregar usuario" }).click()

    await page.getByPlaceholder("Correo").fill("invalid-email")
    await page.getByPlaceholder("Correo").blur()

    await expect(
      page.getByText("La dirección de correo es inválida"),
    ).toBeVisible()
  })

  test("Password must be at least 8 characters", async ({ page }) => {
    await gotoAdminUsers(page)

    await page.getByRole("button", { name: "Agregar usuario" }).click()

    await page.getByPlaceholder("Correo").fill(randomEmail())
    await page.getByPlaceholder("Contraseña").first().fill("short")
    await page.getByPlaceholder("Contraseña").last().fill("short")
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(
      page.getByText("La contraseña debe tener al menos 8 caracteres"),
    ).toBeVisible()
  })

  test("Passwords must match", async ({ page }) => {
    await gotoAdminUsers(page)

    await page.getByRole("button", { name: "Agregar usuario" }).click()

    await page.getByPlaceholder("Correo").fill(randomEmail())
    await page.getByPlaceholder("Contraseña").first().fill(randomPassword())
    await page.getByPlaceholder("Contraseña").last().fill("different12345")
    await page.getByPlaceholder("Contraseña").last().blur()

    await expect(page.getByText("Las contraseñas no coinciden")).toBeVisible()
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "Usuarios" }),
    ).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)

    await gotoAdminUsers(page)

    await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible()
  })
})

test.describe("Admin Printing settings", () => {
  const suffix = () => Math.random().toString(36).substring(7)

  test.afterEach(async ({ request }) => {
    // leave the shared settings as the suite found them
    await api.patch(request, "/business-settings/", {
      default_print_format: "a4",
      voucher_footer: null,
      voucher_legends: null,
    })
  })

  test("Administrator configures printing and the values persist", async ({
    page,
    request,
  }) => {
    await page.goto("/admin")
    await page.getByRole("tab", { name: "Impresión" }).click()

    const footer = `Comprobante E2E ${suffix()}`
    const legends = `Leyenda E2E ${suffix()}`

    await page.getByTestId("printing-format").click()
    await page.getByRole("option", { name: "Ticket 80mm" }).click()
    await page.getByTestId("printing-footer").fill(footer)
    await page.getByTestId("printing-legends").fill(legends)
    await page.getByTestId("printing-save").click()

    await expect(
      page.getByText("Configuración de impresión guardada"),
    ).toBeVisible()

    // persisted through the business-settings PATCH
    const settings = await api.getOne<{
      default_print_format: string
      voucher_footer: string | null
      voucher_legends: string | null
    }>(request, "/business-settings/")
    expect(settings.default_print_format).toBe("ticket80")
    expect(settings.voucher_footer).toBe(footer)
    expect(settings.voucher_legends).toBe(legends)

    // reopening the section shows the saved values
    await page.reload()
    await page.getByRole("tab", { name: "Impresión" }).click()
    await expect(page.getByTestId("printing-format")).toContainText(
      "Ticket 80mm",
    )
    await expect(page.getByTestId("printing-footer")).toHaveValue(footer)
    await expect(page.getByTestId("printing-legends")).toHaveValue(legends)
  })

  test("A footer over the maximum length shows a validation error", async ({
    page,
  }) => {
    await page.goto("/admin")
    await page.getByRole("tab", { name: "Impresión" }).click()

    await page.getByTestId("printing-footer").fill("x".repeat(256))
    await page.getByTestId("printing-save").click()

    await expect(page.getByTestId("printing-footer-error")).toBeVisible()
    await expect(
      page.getByText("Configuración de impresión guardada"),
    ).toHaveCount(0)
  })
})

test.describe("Admin Sell screen settings", () => {
  // the singleton business-settings row is shared: these tests must not race
  test.describe.configure({ mode: "default" })

  const openSellScreenTab = async (page: Page) => {
    await page.goto("/admin")
    await page.getByRole("tab", { name: "Pantalla de venta" }).click()
  }

  test.afterEach(async ({ request }) => {
    // leave the shared settings as the suite found them
    await api.patch(request, "/business-settings/", {
      sell_quick_method_ids: null,
      sell_default_document_type_id: null,
      sell_default_customer_id: null,
      sell_block_price_edit: true,
      sell_hide_date: false,
    })
  })

  test("Administrator configures the sell screen and the values persist", async ({
    page,
    request,
  }) => {
    await openSellScreenTab(page)

    // block price edit is ON by default; hide date is OFF by default
    await expect(page.getByTestId("sellscreen-block-price")).toBeChecked()
    await expect(page.getByTestId("sellscreen-hide-date")).not.toBeChecked()

    await page.getByTestId("sellscreen-block-price").click()
    await page.getByTestId("sellscreen-hide-date").click()
    await page.getByTestId("sellscreen-doc-type").click()
    await page.getByRole("option", { name: "Factura B (FB)" }).click()
    await page.getByTestId("sellscreen-save").click()

    await expect(
      page.getByText("Configuración de venta guardada"),
    ).toBeVisible()

    // persisted through the business-settings PATCH
    const settings = await api.getOne<{
      sell_default_document_type_id: string | null
      sell_block_price_edit: boolean
      sell_hide_date: boolean
    }>(request, "/business-settings/")
    const facturasB = await api
      .get<{ id: string; prefix: string }>(
        request,
        "/document-types/?skip=0&limit=100",
      )
      .then((r) => r.data.find((dt) => dt.prefix === "FB"))
    expect(facturasB).toBeDefined()
    expect(settings.sell_default_document_type_id).toBe(facturasB!.id)
    expect(settings.sell_block_price_edit).toBe(false)
    expect(settings.sell_hide_date).toBe(true)

    // reopening the section shows the saved values
    await page.reload()
    await openSellScreenTab(page)
    await expect(page.getByTestId("sellscreen-block-price")).not.toBeChecked()
    await expect(page.getByTestId("sellscreen-hide-date")).toBeChecked()
    await expect(page.getByTestId("sellscreen-doc-type")).toContainText(
      "Factura B",
    )
  })

  test("Quick payment shortcuts can be selected and reordered", async ({
    page,
    request,
  }) => {
    const methods = await api
      .get<{ id: string; name: string }>(
        request,
        "/payment-methods/?skip=0&limit=100",
      )
      .then((r) => r.data)
    expect(methods.length).toBeGreaterThanOrEqual(2)
    const [first, second] = methods

    await openSellScreenTab(page)

    const chip = (method: { name: string }) =>
      page
        .getByTestId("sellscreen-method-chip")
        .filter({ hasText: method.name })

    // the clickable part of a chip is the button carrying the method name
    await chip(first).getByRole("button", { name: first.name }).click()
    await chip(second).getByRole("button", { name: second.name }).click()

    // second was appended last; move it up so the order flips
    const secondItem = page
      .getByTestId("sellscreen-order-item")
      .filter({ hasText: second.name })
    await secondItem.getByTestId("sellscreen-move-up").click()

    await page.getByTestId("sellscreen-save").click()
    await expect(
      page.getByText("Configuración de venta guardada"),
    ).toBeVisible()

    const settings = await api.getOne<{
      sell_quick_method_ids: string[] | null
    }>(request, "/business-settings/")
    expect(settings.sell_quick_method_ids).toEqual([second.id, first.id])

    // reopening the section shows the saved order
    await page.reload()
    await openSellScreenTab(page)
    await expect(
      page
        .getByTestId("sellscreen-order-item")
        .filter({ hasText: second.name }),
    ).toContainText("1.")
    await expect(
      page.getByTestId("sellscreen-order-item").filter({ hasText: first.name }),
    ).toContainText("2.")
  })
})
