import { expect, type Page, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
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
  test("Create a new user successfully", async ({ page }) => {
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
  })

  test("Create a superuser", async ({ page }) => {
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
  })

  test("Edit a user successfully", async ({ page }) => {
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
