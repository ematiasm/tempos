import { expect, test } from "@playwright/test"
import {
  api,
  createPaidPaymentMethod,
  createProduct,
  createSupplier,
  createSupplierProduct,
  getPaymentMethods,
  getUoms,
  readDocuments,
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
  await expect(suggestion.getByText("$100,00 → $130,00")).toBeVisible()

  await suggestion
    .getByRole("button", { name: `Aplicar $${newCost.toFixed(2).replace(".", ",")}` })
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
    .getByRole("button", { name: `Aplicar $${newCost.toFixed(2).replace(".", ",")}` })
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

test.describe("Buy split payment", () => {
  let cashMethodId: string

  test.beforeAll(async ({ request }) => {
    const cashMethod = await getPaymentMethods(request)
    cashMethodId = cashMethod?.id ?? ""
    if (!cashMethodId) throw new Error("Cash payment method not seeded")
  })

  test("Split payment across two methods leaves supplier debt", async ({
    page,
    request,
  }) => {
    const uid = () => Math.random().toString(36).substring(7)
    const suffix = uid()
    const supplierName = `Proveedor Split ${suffix}`
    const productName = `Producto Split ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name: productName,
      sku: `SPL-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    const supplier = await createSupplier(request, supplierName)
    await createSupplierProduct(request, {
      supplier_id: supplier.id,
      product_id: product.id,
      costo_actual: 100,
    })
    const debitMethod = await createPaidPaymentMethod(
      request,
      `Débito Split ${suffix}`,
    )

    await page.goto("/buy")

    await page.getByTestId("supplier-select").click()
    await page.getByRole("option", { name: supplierName }).click()

    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    // Open split dialog
    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    // Row 0: cash 40 (prefilled with 100)
    await page.getByTestId("split-row-0-amount").fill("40")

    // Row 1: debit 40 — prefilled with remaining 60
    await page.getByTestId("split-add-row").click()
    await expect(page.getByTestId("split-row-1-amount")).toHaveValue("60")
    await page.getByTestId("split-row-1-method").click()
    await page
      .getByRole("option", { name: new RegExp(`Débito Split ${suffix}`) })
      .click()
    await page.getByTestId("split-row-1-amount").fill("40")

    // Verify metrics
    await expect(page.getByTestId("split-covered")).toHaveText(
      "Cubierto: $80,00",
    )
    await expect(page.getByTestId("split-remaining")).toHaveText(
      "Restante: $20,00",
    )

    // Confirm button enabled and says "Confirmar y adeudar $20,00"
    await expect(page.getByTestId("split-confirm")).toBeEnabled()
    await expect(page.getByTestId("split-confirm")).toHaveText(
      /Confirmar y adeudar/,
    )

    await page.getByTestId("split-confirm").click()

    // Split summary shows debt
    await expect(page.getByTestId("split-summary")).toBeVisible()
    await expect(page.getByTestId("split-summary-debt")).toHaveText(
      /Queda pendiente con el proveedor/,
    )

    // Create the purchase
    await page.getByTestId("create-purchase-button").click()

    await expect(
      page.getByRole("heading", { name: /^\d{4}-OC-/ }),
    ).toBeVisible()

    // Verify via API: 2 payments, supplier balance reflects debt
    const docs = await readDocuments(request)
    const purchase = docs.find((d) =>
      d.lines.some((l) => l.product_name === productName),
    )
    expect(purchase).toBeDefined()
    expect(purchase?.payments).toHaveLength(2)
    const cashRow = purchase?.payments.find(
      (p) => p.payment_method_id === cashMethodId,
    )
    const debitRow = purchase?.payments.find(
      (p) => p.payment_method_id === debitMethod.id,
    )
    expect(cashRow?.monto).toBe("40.00")
    expect(debitRow?.monto).toBe("40.00")

    const supplierAfter = await api.getOne<{ saldo: string }>(
      request,
      `/suppliers/${supplier.id}`,
    )
    expect(supplierAfter.saldo).toBe("20.00")
  })

  test("Split summary edit and clear restores inline payment", async ({
    page,
    request,
  }) => {
    const uid = () => Math.random().toString(36).substring(7)
    const suffix = uid()
    const supplierName = `Proveedor SplitClr ${suffix}`
    const productName = `Producto SplitClr ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name: productName,
      sku: `SPC-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    const supplier = await createSupplier(request, supplierName)
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
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    // Open split, set partial, confirm
    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()
    await page.getByTestId("split-row-0-amount").fill("40")
    await page.getByTestId("split-confirm").click()

    // Summary visible → click edit → dialog reopens with 40
    await expect(page.getByTestId("split-summary")).toBeVisible()
    await page.getByTestId("split-edit").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()
    await expect(page.getByTestId("split-row-0-amount")).toHaveValue("40")
    // Close dialog
    await page.getByTestId("split-confirm").click()

    // Clear → inline single payment restored
    await page.getByTestId("split-clear").click()
    await expect(page.getByTestId("split-summary")).toHaveCount(0)
    // The inline amount input should be visible (not the split summary)
    await expect(page.getByTestId("create-purchase-button")).toBeVisible()
  })
})
