import { expect, test } from "@playwright/test"
import { createUser } from "./utils/privateApi"
import {
  randomEmail,
  randomItemDescription,
  randomItemTitle,
  randomPassword,
} from "./utils/random"
import { logInUser } from "./utils/user"

test("Items page is accessible and shows correct title", async ({ page }) => {
  await page.goto("/items")
  await expect(page.getByRole("heading", { name: "Ítems" })).toBeVisible()
  await expect(page.getByText("Creá y gestioná tus ítems")).toBeVisible()
})

test("Add Item button is visible", async ({ page }) => {
  await page.goto("/items")
  await expect(page.getByRole("button", { name: "Agregar ítem" })).toBeVisible()
})

test.describe("Items management", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string
  const password = randomPassword()

  test.beforeAll(async () => {
    email = randomEmail()
    await createUser({ email, password })
  })

  test.beforeEach(async ({ page }) => {
    await logInUser(page, email, password)
    await page.goto("/items")
  })

  test("Create a new item successfully", async ({ page }) => {
    const title = randomItemTitle()
    const description = randomItemDescription()

    await page.getByRole("button", { name: "Agregar ítem" }).click()
    await page.getByPlaceholder("Título").fill(title)
    await page.getByPlaceholder("Descripción").fill(description)
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(page.getByText("Ítem creado correctamente")).toBeVisible()
    await expect(page.getByText(title)).toBeVisible()
  })

  test("Create item with only required fields", async ({ page }) => {
    const title = randomItemTitle()

    await page.getByRole("button", { name: "Agregar ítem" }).click()
    await page.getByPlaceholder("Título").fill(title)
    await page.getByRole("button", { name: "Guardar" }).click()

    await expect(page.getByText("Ítem creado correctamente")).toBeVisible()
    await expect(page.getByText(title)).toBeVisible()
  })

  test("Cancel item creation", async ({ page }) => {
    await page.getByRole("button", { name: "Agregar ítem" }).click()
    await page.getByPlaceholder("Título").fill("Test Item")
    await page.getByRole("button", { name: "Cancelar" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("Title is required", async ({ page }) => {
    await page.getByRole("button", { name: "Agregar ítem" }).click()
    await page.getByPlaceholder("Título").fill("")
    await page.getByPlaceholder("Título").blur()

    await expect(page.getByText("El título es obligatorio")).toBeVisible()
  })

  test.describe("Edit and Delete", () => {
    let itemTitle: string

    test.beforeEach(async ({ page }) => {
      itemTitle = randomItemTitle()

      await page.getByRole("button", { name: "Agregar ítem" }).click()
      await page.getByPlaceholder("Título").fill(itemTitle)
      await page.getByRole("button", { name: "Guardar" }).click()
      await expect(page.getByText("Ítem creado correctamente")).toBeVisible()
      await expect(page.getByRole("dialog")).not.toBeVisible()
    })

    test("Edit an item successfully", async ({ page }) => {
      const itemRow = page.getByRole("row").filter({ hasText: itemTitle })
      await itemRow.getByRole("button").last().click()
      await page.getByRole("menuitem", { name: "Editar ítem" }).click()

      const updatedTitle = randomItemTitle()
      await page.getByPlaceholder("Título").fill(updatedTitle)
      await page.getByRole("button", { name: "Guardar" }).click()

      await expect(
        page.getByText("Ítem actualizado correctamente"),
      ).toBeVisible()
      await expect(page.getByText(updatedTitle)).toBeVisible()
    })

    test("Delete an item successfully", async ({ page }) => {
      const itemRow = page.getByRole("row").filter({ hasText: itemTitle })
      await itemRow.getByRole("button").last().click()
      await page.getByRole("menuitem", { name: "Eliminar ítem" }).click()

      await page.getByRole("button", { name: "Eliminar" }).click()

      await expect(
        page.getByText("El ítem se eliminó correctamente"),
      ).toBeVisible()
      await expect(page.getByText(itemTitle)).not.toBeVisible()
    })
  })
})

test.describe("Items empty state", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Shows empty state message when no items exist", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/items")

    await expect(page.getByText("Todavía no tenés ítems")).toBeVisible()
    await expect(page.getByText("Agregá un ítem para empezar")).toBeVisible()
  })
})
