import { expect, test } from "@playwright/test"
import { getUoms } from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

test("Create a unit of measure from the admin panel", async ({ page }) => {
  const name = `Kilogramo E2E ${uid()}`
  const abbreviation = "kg"

  await page.goto("/admin")
  await page.getByRole("tab", { name: "Unidades" }).click()
  await page.getByRole("button", { name: "Agregar unidad" }).click()

  await page.getByLabel("Nombre *").fill(name)
  await page.getByLabel("Abreviatura *").fill(abbreviation)
  await page.getByRole("button", { name: "Guardar" }).click()

  await expect(
    page.getByText("Unidad de medida creada correctamente"),
  ).toBeVisible()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(page.getByText(name)).toBeVisible()
})

test("Create a tax from the admin panel", async ({ page }) => {
  const name = `IVA E2E ${uid()}`
  const code = `IVAE2E${uid().toUpperCase()}`

  await page.goto("/admin")
  await page.getByRole("tab", { name: "Impuestos" }).click()
  await page.getByRole("button", { name: "Agregar impuesto" }).click()

  await page.getByLabel("Nombre *").fill(name)
  await page.getByLabel("Código *").fill(code)
  await page.getByLabel("Tasa *").fill("25")
  await page.getByRole("button", { name: "Guardar" }).click()

  await expect(page.getByText("Impuesto creado correctamente")).toBeVisible()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(page.getByText(name)).toBeVisible()
})

test("Create a product and find it in the catalog", async ({ page }) => {
  const name = `Producto E2E Cat ${uid()}`
  const sku = `CAT-${uid().toUpperCase()}`

  const uoms = await getUoms(page.request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]

  await page.goto("/catalog/products")
  await page.getByRole("button", { name: "Agregar producto" }).click()

  await page.getByLabel("Nombre *").fill(name)
  await page.getByLabel("SKU").fill(sku)
  await page.getByLabel("Unidad *").click()
  await page.getByRole("option", { name: new RegExp(uom.name) }).click()
  await page.getByLabel("Costo *").fill("100")
  await page.getByLabel("Margen % *").fill("50")
  await page.getByRole("button", { name: "Guardar" }).click()

  await expect(page.getByText("Producto creado correctamente")).toBeVisible()
  await expect(page.getByRole("dialog")).not.toBeVisible()

  await page
    .getByPlaceholder("Buscar por nombre, SKU o código de barras...")
    .fill(sku)
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()
})

test("Product is searchable and addable from the sell page", async ({
  page,
}) => {
  const name = `Producto E2E Sell ${uid()}`
  const sku = `SEL-${uid().toUpperCase()}`

  const uoms = await getUoms(page.request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]

  await page.goto("/catalog/products")
  await page.getByRole("button", { name: "Agregar producto" }).click()
  await page.getByLabel("Nombre *").fill(name)
  await page.getByLabel("SKU").fill(sku)
  await page.getByLabel("Unidad *").click()
  await page.getByRole("option", { name: new RegExp(uom.name) }).click()
  await page.getByLabel("Costo *").fill("100")
  await page.getByLabel("Margen % *").fill("50")
  await page.getByRole("button", { name: "Guardar" }).click()
  await expect(page.getByText("Producto creado correctamente")).toBeVisible()

  await page.goto("/sell")
  await page.getByTestId("product-search").fill(name)
  await page.getByRole("button", { name: new RegExp(name) }).click()

  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()
})
