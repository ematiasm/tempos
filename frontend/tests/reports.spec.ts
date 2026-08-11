import { expect, type Page, test } from "@playwright/test"
import { adjustStock, createProduct, createSale, getUoms } from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

const TAB_LABELS = [
  "Ventas diarias",
  "Margen",
  "Impuestos",
  "Stock bajo",
  "A reponer",
  "Movimientos",
  "Cuentas corrientes",
]

const findRowInPages = async (page: Page, text: string) => {
  for (let i = 0; i < 10; i++) {
    const row = page.getByRole("row").filter({ hasText: text })
    if ((await row.count()) > 0) return row
    const next = page.getByRole("button", { name: "Go to next page" })
    if (!(await next.isEnabled())) break
    await next.click()
  }
  return page.getByRole("row").filter({ hasText: text })
}

test.describe("Reports", () => {
  let lowStockName: string
  let saleProductName: string
  let saleNumero: string

  test.beforeAll(async ({ request }) => {
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]

    lowStockName = `Producto E2E Bajo ${uid()}`
    const low = await createProduct(request, {
      name: lowStockName,
      sku: `BAJ-${uid().toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
      stock_minimo: 5,
    })
    await adjustStock(request, low.id, 3)

    saleProductName = `Producto E2E Rep ${uid()}`
    const saleProduct = await createProduct(request, {
      name: saleProductName,
      sku: `REP-${uid().toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, saleProduct.id, 5)

    const paid = await createSale(request, {
      productId: saleProduct.id,
      price: 150,
    })
    saleNumero = paid.numero
    await createSale(request, { productId: saleProduct.id, paid: false })
  })

  test("All report tabs are available", async ({ page }) => {
    await page.goto("/reports")

    for (const tab of TAB_LABELS) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible()
    }
  })

  test("Daily sales shows today's sales", async ({ page }) => {
    await page.goto("/reports")

    await expect(page.getByText(/ventas \/ \d+ días/)).toBeVisible()
    await expect(page.getByText(/Total \$\d+\.\d{2}/)).toBeVisible()
  })

  test("Low stock lists the product below its minimum", async ({ page }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "Stock bajo" }).click()

    await expect(await findRowInPages(page, lowStockName)).toBeVisible()
  })

  test("Movements show the sale document", async ({ page }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "Movimientos" }).click()

    await expect(await findRowInPages(page, saleNumero)).toBeVisible()
  })

  test("Current accounts show the credit sale", async ({ page }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "Cuentas corrientes" }).click()

    const row = page.getByRole("row").filter({ hasText: "Consumidor Final" })
    await expect(row).toBeVisible()
  })
})
