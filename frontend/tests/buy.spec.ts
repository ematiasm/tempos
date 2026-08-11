import { expect, test } from "@playwright/test"
import {
  createProduct,
  createSupplier,
  createSupplierProduct,
  getUoms,
  readProduct,
  readSupplierProducts,
} from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

test("Buy at a new cost and apply the suggested cost change", async ({
  page,
  request,
}) => {
  const uoms = await getUoms(request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
  const supplierName = `Proveedor E2E ${uid()}`
  const productName = `Producto E2E Compra ${uid()}`
  const newCost = 130

  const supplier = await createSupplier(request, supplierName)
  const product = await createProduct(request, {
    name: productName,
    sku: `COM-${uid().toUpperCase()}`,
    uom_id: uom.id,
    costo_actual: 100,
    margen_pct: 50,
  })
  await createSupplierProduct(request, {
    supplier_id: supplier.id,
    product_id: product.id,
    costo_actual: 100,
  })

  await page.goto("/buy")

  await page.getByTestId("supplier-select").click()
  await page.getByRole("option", { name: supplierName }).click()

  await page.getByTestId("product-search").fill(productName)
  await page.getByRole("button", { name: new RegExp(productName) }).click()

  const row = page.getByRole("row").filter({ hasText: productName })
  await expect(row).toBeVisible()
  await row.getByRole("spinbutton").first().fill(String(newCost))

  await page.getByTestId("create-purchase-button").click()

  await expect(page.getByRole("heading", { name: /^\d{4}-OC-/ })).toBeVisible()
  await expect(page.getByText(/Compra \d{4}-OC-.* creada/)).toBeVisible()

  await expect(page.getByText("Sugerencias de cambio de costo")).toBeVisible()
  const suggestion = page.getByText(productName).locator("..").locator("..")
  await expect(suggestion.getByText("$100.00 → $130.00")).toBeVisible()

  await suggestion
    .getByRole("button", { name: `Aplicar $${newCost.toFixed(2)}` })
    .click()

  await expect(page.getByText("Costo actualizado")).toBeVisible()

  const pairs = await readSupplierProducts(request, supplier.id)
  expect(Number(pairs[0].costo_actual)).toBe(newCost)

  const productAfter = await readProduct(request, product.id)
  expect(Number(productAfter.costo_actual)).toBe(newCost)
  expect(Number(productAfter.precio_venta)).toBe(newCost * 1.5)
})

test("Buying from a new supplier promotes it to reference and updates the product cost", async ({
  page,
  request,
}) => {
  const uoms = await getUoms(request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
  const refSupplierName = `Proveedor E2E Ref ${uid()}`
  const otherSupplierName = `Proveedor E2E Otro ${uid()}`
  const productName = `Producto E2E Ref ${uid()}`
  const newCost = 150

  const refSupplier = await createSupplier(request, refSupplierName)
  const otherSupplier = await createSupplier(request, otherSupplierName)
  const product = await createProduct(request, {
    name: productName,
    sku: `REF-${uid().toUpperCase()}`,
    uom_id: uom.id,
    costo_actual: 100,
    margen_pct: 50,
  })
  await createSupplierProduct(request, {
    supplier_id: refSupplier.id,
    product_id: product.id,
    costo_actual: 100,
  })

  await page.goto("/buy")

  await page.getByTestId("supplier-select").click()
  await page.getByRole("option", { name: otherSupplierName }).click()

  await page.getByTestId("product-search").fill(productName)
  await page.getByRole("button", { name: new RegExp(productName) }).click()

  const row = page.getByRole("row").filter({ hasText: productName })
  await expect(row).toBeVisible()
  await row.getByRole("spinbutton").first().fill(String(newCost))

  await page.getByTestId("create-purchase-button").click()

  await expect(page.getByRole("heading", { name: /^\d{4}-OC-/ })).toBeVisible()
  await expect(page.getByText("Sugerencias de cambio de costo")).toBeVisible()
  await page
    .getByRole("button", { name: `Aplicar $${newCost.toFixed(2)}` })
    .click()
  await expect(page.getByText("Costo actualizado")).toBeVisible()

  const pairs = await readSupplierProducts(request, otherSupplier.id)
  expect(Number(pairs[0].costo_actual)).toBe(newCost)
  expect(pairs[0].es_referencia).toBe(true)

  const refPairs = await readSupplierProducts(request, refSupplier.id)
  expect(refPairs[0].es_referencia).toBe(false)

  const productAfter = await readProduct(request, product.id)
  expect(Number(productAfter.costo_actual)).toBe(newCost)
  expect(Number(productAfter.precio_venta)).toBe(newCost * 1.5)
})
