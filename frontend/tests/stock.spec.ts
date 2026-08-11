import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test"
import { adjustStock, createProduct, getUoms, readProduct } from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

test.describe("Stock adjustments", () => {
  const createStockedProduct = async (
    request: APIRequestContext,
    prefix: string,
    stock: number,
  ) => {
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const name = `Producto E2E Stock ${prefix} ${uid()}`
    const product = await createProduct(request, {
      name,
      sku: `STK-${prefix}-${uid().toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    if (stock !== 0) await adjustStock(request, product.id, stock)
    return { name, id: product.id }
  }

  const addToAdjust = async (page: Page, name: string, qty: number) => {
    await page.goto("/stock")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole("spinbutton").fill(String(qty))
  }

  test("Add stock with a positive adjustment", async ({ page, request }) => {
    const { name, id } = await createStockedProduct(request, "A", 0)

    await addToAdjust(page, name, 5)
    await page.getByRole("button", { name: "Agregar stock (1)" }).click()

    await expect(page.getByText(/Ajuste \d{4}-AJS-.* registrado/)).toBeVisible()
    await expect(
      page.getByRole("heading", { name: /^\d{4}-AJS-/ }),
    ).toBeVisible()

    const product = await readProduct(request, id)
    expect(Number(product.stock_current)).toBe(5)
  })

  test("Remove stock with a negative adjustment", async ({ page, request }) => {
    const { name, id } = await createStockedProduct(request, "B", 5)

    await addToAdjust(page, name, -2)
    await page.getByRole("button", { name: "Quitar stock (1)" }).click()

    await expect(page.getByText(/Ajuste \d{4}-AJS-.* registrado/)).toBeVisible()

    const product = await readProduct(request, id)
    expect(Number(product.stock_current)).toBe(3)
  })

  test("Negative adjustments are allowed as deliberate corrections", async ({
    page,
    request,
  }) => {
    const { name, id } = await createStockedProduct(request, "C", 1)

    await addToAdjust(page, name, -2)
    await page.getByRole("button", { name: "Quitar stock (1)" }).click()

    await expect(page.getByText(/Ajuste \d{4}-AJS-.* registrado/)).toBeVisible()

    const product = await readProduct(request, id)
    expect(Number(product.stock_current)).toBe(-1)
  })
})
