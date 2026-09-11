import { expect, test } from "@playwright/test"
import {
  adjustStock,
  createCustomer,
  createProduct,
  createSale,
  getUoms,
} from "./utils/api"
import { findRowInPages } from "./utils/table"

const uid = () => Math.random().toString(36).substring(7)

const TAB_LABELS = [
  "Ventas diarias",
  "Métodos de pago",
  "Por cajero",
  "Margen",
  "Impuestos",
  "A reponer",
  "Movimientos",
]

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
    // An unpaid sale needs a regular customer: 'Consumidor Final' can never
    // carry a balance (consumidor_final_no_credit).
    const creditCustomer = await createCustomer(
      request,
      `Cliente Rep Crédito ${uid()}`,
    )
    await createSale(request, {
      productId: saleProduct.id,
      customerId: creditCustomer.id,
      paid: false,
    })
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
    // The suite pins the business locale to `es`, so money renders with es-AR
    // conventions: a dot groups thousands and a comma separates decimals. The old
    // pattern expected the US shape (`1,234.50`), so it only matched once the day's
    // accumulated total reached four digits and the dot showed up as a thousands
    // separator — whether the assertion passed depended on the total, not on the page.
    await expect(page.getByText(/Total \$\d{1,3}(\.\d{3})*,\d{2}\b/)).toBeVisible()
  })

  // LowStock was merged into Reponer: the same below-minimum product must
  // still be listed through the reorder tab.
  test("Reponer lists the product below its minimum", async ({ page }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "A reponer" }).click()

    await expect(await findRowInPages(page, lowStockName)).toBeVisible()
  })

  // Deterministic ordering (fecha desc, id desc tiebreaker) keeps the
  // freshly created sale's movement inside the fetched window.
  test("Movements show the sale document", async ({ page }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "Movimientos" }).click()

    await expect(await findRowInPages(page, saleNumero)).toBeVisible()
  })
})
