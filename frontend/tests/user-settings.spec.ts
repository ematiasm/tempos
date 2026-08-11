import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomFullName, randomPassword } from "./utils/random"
import { logInUser, logOutUser } from "./utils/user"

test.describe("User settings page", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)
    await page.goto("/settings")
  })

  test("Tabs are visible", async ({ page }) => {
    const tabs = ["Mi perfil", "Contraseña", "Zona de peligro"]

    for (const tab of tabs) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible()
    }
  })

  test("Update user information successfully", async ({ page }) => {
    const updatedFullName = randomFullName()

    await page.getByRole("button", { name: "Editar" }).click()
    await page.getByLabel("Nombre completo").fill(updatedFullName)
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(
      page.getByText("Usuario actualizado correctamente"),
    ).toBeVisible()
    await expect(
      page.getByLabel("Mi perfil").getByText(updatedFullName),
    ).toBeVisible()
  })

  test("Invalid email shows error", async ({ page }) => {
    await page.getByRole("button", { name: "Editar" }).click()
    await page.getByLabel("Correo").fill("invalid-email")
    await page.getByLabel("Correo").blur()

    await expect(
      page.getByText("La dirección de correo es inválida"),
    ).toBeVisible()
  })

  test.describe("Password change with dedicated user", () => {
    let email: string
    let password: string

    test.beforeAll(async () => {
      email = randomEmail()
      password = randomPassword()
      await createUser({ email, password })
    })

    test("Change password with short password shows error", async ({
      page,
    }) => {
      await logInUser(page, email, password)
      await page.goto("/settings")
      await page.getByRole("tab", { name: "Contraseña" }).click()

      await page.getByTestId("current-password-input").fill(password)
      await page.getByTestId("new-password-input").fill("short")
      await page.getByTestId("confirm-password-input").fill("short")
      await page.getByRole("button", { name: "Actualizar contraseña" }).click()

      await expect(
        page.getByText("La contraseña debe tener al menos 8 caracteres"),
      ).toBeVisible()
    })

    test("New password cannot be the same as the current one", async ({
      page,
    }) => {
      await logInUser(page, email, password)
      await page.goto("/settings")
      await page.getByRole("tab", { name: "Contraseña" }).click()

      await page.getByTestId("current-password-input").fill(password)
      await page.getByTestId("new-password-input").fill(password)
      await page.getByTestId("confirm-password-input").fill(password)
      await page.getByRole("button", { name: "Actualizar contraseña" }).click()

      await expect(
        page.getByText("New password cannot be the same as the current one"),
      ).toBeVisible()
    })

    test("Update password successfully and log in with new password", async ({
      page,
    }) => {
      const newPassword = randomPassword()

      await logInUser(page, email, password)
      await page.goto("/settings")
      await page.getByRole("tab", { name: "Contraseña" }).click()

      await page.getByTestId("current-password-input").fill(password)
      await page.getByTestId("new-password-input").fill(newPassword)
      await page.getByTestId("confirm-password-input").fill(newPassword)
      await page.getByRole("button", { name: "Actualizar contraseña" }).click()

      await expect(
        page.getByText("Contraseña actualizada correctamente"),
      ).toBeVisible()

      await logOutUser(page)
      await logInUser(page, email, newPassword)
    })
  })

  test("Delete account from danger zone", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/settings")
    await page.getByRole("tab", { name: "Zona de peligro" }).click()

    await page.getByRole("button", { name: "Eliminar cuenta" }).click()
    await page.getByRole("button", { name: "Eliminar" }).click()

    await expect(
      page.getByText("Tu cuenta se eliminó correctamente"),
    ).toBeVisible()
  })
})
