import { expect, type Page, test } from "@playwright/test"
import {
  adjustStock,
  api,
  createCreditPaymentMethod,
  createCustomer,
  createProduct,
  createReceipt,
  findDocumentType,
  getDocumentTypes,
  getPaymentMethods,
  getUoms,
  readDocuments,
  readOutstanding,
  readProduct,
  readReceiptAllocations,
} from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

test.describe("Sell flow", () => {
  let productName: string
  let productId: string
  const _price = 150

  test.beforeAll(async ({ request }) => {
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    productName = `Producto E2E Venta ${uid()}`
    const product = await createProduct(request, {
      name: productName,
      sku: `VEN-${uid().toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    productId = product.id
    await adjustStock(request, productId, 5)
  })

  const searchAndAdd = async (page: Page) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()
  }

  test("Issue a sale to Consumidor Final", async ({ page, request }) => {
    await searchAndAdd(page)

    await page.getByTestId("customer-select").click()
    await page.getByRole("option", { name: "Consumidor Final" }).click()

    await page.getByTestId("issue-sale-button").click()

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""
    expect(numeroText).toMatch(/^\d{4}-FC-/)

    await expect(page.getByText(`Venta ${numeroText} emitida`)).toBeVisible()

    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.document_type.prefix).toBe("FC")

    const product = await readProduct(request, productId)
    expect(Number(product.stock_current)).toBe(4)
  })

  test("Print the voucher of a sale", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        ;(window as unknown as { __printed?: boolean }).__printed = true
      }
    })

    await searchAndAdd(page)
    await page.getByTestId("issue-sale-button").click()
    await expect(page.getByTestId("sale-success-numero")).toBeVisible()

    await page.getByRole("button", { name: "Imprimir comprobante" }).click()
    await expect(
      page.getByRole("button", { name: "Imprimir", exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Imprimir", exact: true }).click()

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __printed?: boolean }).__printed,
        ),
      )
      .toBe(true)
  })

  test("New sale resets the form", async ({ page }) => {
    await searchAndAdd(page)
    await page.getByTestId("issue-sale-button").click()
    await expect(page.getByTestId("sale-success-numero")).toBeVisible()

    await page.getByRole("button", { name: "Nueva venta" }).click()
    await expect(page.getByTestId("product-search")).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toHaveCount(0)
  })

  test("Cannot sell more stock than available", async ({ page, request }) => {
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const name = `Producto E2E Sin Stock ${uid()}`
    const product = await createProduct(request, {
      name,
      sku: `SIN-${uid().toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    await page.getByTestId("issue-sale-button").click()

    await expect(
      page.getByText("Stock insuficiente para completar la operación"),
    ).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)

    const after = await readProduct(request, product.id)
    expect(Number(after.stock_current)).toBe(0)
  })

  test("Sale on credit applies the customer's credit in favor", async ({
    page,
    request,
  }) => {
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const suffix = uid()
    const productName = `Producto E2E Crédito Favor ${suffix}`
    const product = await createProduct(request, {
      name: productName,
      sku: `CRE-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 5)

    const customer = await createCustomer(
      request,
      `Cliente Crédito Favor ${suffix}`,
    )
    const cashMethod = await getPaymentMethods(request)
    if (!cashMethod) throw new Error("Cash payment method not seeded")
    const types = await getDocumentTypes(request)
    const fc = findDocumentType(types, "FC")

    await api.post(request, "/documents/", {
      document_type_id: fc.id,
      contraparte_id: customer.id,
      lines: [{ product_id: product.id, cantidad: 1, precio_unit: 150 }],
      payments: [{ payment_method_id: cashMethod.id, monto: 250 }],
    })

    const customersBefore = await api
      .get<{ id: string; saldo: string }>(
        request,
        "/customers/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    const withFavor = customersBefore.find((c) => c.id === customer.id)
    expect(withFavor?.saldo).toBe("-100.00")

    await createCreditPaymentMethod(request, `Cuenta Corriente ${suffix}`)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    await page.getByTestId("customer-select").click()
    await page
      .getByRole("option", { name: new RegExp(customer.razon_social) })
      .click()

    await page.getByText("Venta a crédito").click()

    const favorLabel = page.getByText("Usar $100.00 de crédito a favor")
    await expect(favorLabel).toBeVisible()
    await expect(favorLabel.locator("input")).toBeChecked()
    await expect(
      page.getByText(
        "El monto ($50.00) se registra en la cuenta corriente del cliente. No se cobra dinero.",
      ),
    ).toBeVisible()

    await favorLabel.click()
    await expect(favorLabel).toBeVisible()
    await expect(favorLabel.locator("input")).not.toBeChecked()
    // on a credit sale the favor still nets automatically: the net charge
    // that remains on the current account stays at 50.00
    await expect(
      page.getByText(
        "El monto ($50.00) se registra en la cuenta corriente del cliente. No se cobra dinero.",
      ),
    ).toBeVisible()

    await favorLabel.click()
    await expect(favorLabel.locator("input")).toBeChecked()
    await expect(
      page.getByText(
        "El monto ($50.00) se registra en la cuenta corriente del cliente. No se cobra dinero.",
      ),
    ).toBeVisible()

    await page.getByTestId("issue-sale-button").click()

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""

    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    // the remainder (50.00) is charged on credit; the favor portion is
    // recorded on the document as favor_monto
    expect(sale?.payments).toHaveLength(1)
    expect(sale?.payments[0].monto).toBe("50.00")
    expect(sale?.favor_monto).toBe("100.00")

    // only the 50.00 credit remainder stays outstanding
    const outstanding = await readOutstanding(request, "customer", customer.id)
    expect(outstanding).toHaveLength(1)
    expect(outstanding[0].document_id).toBe(sale?.id)
    expect(outstanding[0].pendiente).toBe("50.00")

    const customersAfter = await api
      .get<{ id: string; saldo: string }>(
        request,
        "/customers/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    const after = customersAfter.find((c) => c.id === customer.id)
    expect(after?.saldo).toBe("50.00")
  })

  test("A receipt issued before a sale is imputed to the sale", async ({
    page,
    request,
  }) => {
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const suffix = uid()
    const productName = `Producto E2E Recibo Previo ${suffix}`
    const product = await createProduct(request, {
      name: productName,
      sku: `RPV-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 5)

    const customer = await createCustomer(
      request,
      `Cliente Recibo Previo ${suffix}`,
    )
    const cashMethod = await getPaymentMethods(request)
    if (!cashMethod) throw new Error("Cash payment method not seeded")

    // receipt issued before any sale: 100.00 stays on account as credit
    const receipt = await createReceipt(request, {
      contraparteType: "customer",
      contraparteId: customer.id,
      methodId: cashMethod.id,
      monto: 100,
    })
    expect(receipt.document_type.prefix).toBe("RC")
    expect(await readReceiptAllocations(request, receipt.id)).toHaveLength(0)

    const customersBefore = await api
      .get<{ id: string; saldo: string }>(
        request,
        "/customers/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    const withFavor = customersBefore.find((c) => c.id === customer.id)
    expect(withFavor?.saldo).toBe("-100.00")

    // the UI sale auto-applies the credit in favor (amount = 50.00)
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    await page.getByTestId("customer-select").click()
    await page
      .getByRole("option", { name: new RegExp(customer.razon_social) })
      .click()

    const favorLabel = page.getByText("Usar $100.00 de crédito a favor")
    await expect(favorLabel.locator("input")).toBeChecked()

    await page.getByTestId("issue-sale-button").click()
    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""

    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.total).toBe("150.00")
    expect(sale?.favor_monto).toBe("0.00")
    expect(sale?.payments).toHaveLength(1)
    expect(sale?.payments[0].monto).toBe("50.00")

    // the receipt is now imputed to the sale
    const allocations = await readReceiptAllocations(request, receipt.id)
    expect(allocations).toHaveLength(1)
    expect(allocations[0].document_id).toBe(sale?.id)
    expect(allocations[0].monto).toBe("100.00")

    // nothing remains outstanding and the balance nets to zero
    const outstanding = await readOutstanding(request, "customer", customer.id)
    expect(outstanding).toHaveLength(0)

    const customersAfter = await api
      .get<{ id: string; saldo: string }>(
        request,
        "/customers/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    const after = customersAfter.find((c) => c.id === customer.id)
    expect(after?.saldo).toBe("0.00")
  })
})
