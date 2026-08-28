import { expect, type Page, test } from "@playwright/test"
import {
  adjustStock,
  api,
  closeCashSession,
  createCreditPaymentMethod,
  createCustomer,
  createPaidPaymentMethod,
  createProduct,
  createReceipt,
  ensureOpenCashSession,
  findDocumentType,
  getDocumentTypes,
  getPaymentMethods,
  getUoms,
  readDocuments,
  readOutstanding,
  readProduct,
  readReceiptAllocations,
} from "./utils/api"

// the sell tests share the open cash session, so they must not race each other
test.describe.configure({ mode: "default" })

const uid = () => Math.random().toString(36).substring(7)

const mockOpenSession = (page: Page) =>
  page.route("**/api/v1/cash-sessions/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000000",
        status: "open",
        opened_at: new Date().toISOString(),
        opening_amount: "0",
        opened_by_name: null,
      }),
    }),
  )

const mockNoSession = (page: Page) =>
  page.route("**/api/v1/cash-sessions/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(null),
    }),
  )

test.describe("Sell flow", () => {
  let productName: string
  let productId: string
  const _price = 150

  test.beforeAll(async ({ request }) => {
    await ensureOpenCashSession(request)
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
    // every test in this file sells the shared fixture: stock it generously
    // so per-test assertions (like the oversell block) stay isolated
    await adjustStock(request, productId, 500)
  })

  test.afterEach(async ({ request }) => {
    // tests that close the session must not leak that state to the others
    await ensureOpenCashSession(request)
  })

  const searchAndAdd = async (page: Page) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()
  }

  const payQuick = async (page: Page, methodName: string) => {
    await page
      .getByTestId("quick-pay-button")
      .filter({ hasText: methodName })
      .click()
  }

  test("Issue a sale to Consumidor Final", async ({ page, request }) => {
    await searchAndAdd(page)

    await page.getByTestId("customer-select").click()
    await page.getByRole("option", { name: "Consumidor Final" }).click()

    await payQuick(page, "Efectivo")

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
    // shared fixture is stocked with 500 (see beforeAll): one sale consumed
    expect(Number(product.stock_current)).toBe(499)
  })

  test("Print the voucher of a sale", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        ;(window as unknown as { __printed?: boolean }).__printed = true
      }
    })

    await searchAndAdd(page)
    await payQuick(page, "Efectivo")
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
    await payQuick(page, "Efectivo")
    await expect(page.getByTestId("sale-success-numero")).toBeVisible()

    await page.getByRole("button", { name: "Nueva venta" }).click()
    await expect(page.getByTestId("product-search")).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toHaveCount(0)
  })

  test("Cannot sell more stock than available", async ({ page, request }) => {
    // the oversell block only applies when the stock policy is "block";
    // pin the precondition instead of trusting ambient environment data
    await api.patch(request, "/business-settings/", { stock_policy: "block" })
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

    await payQuick(page, "Efectivo")

    await expect(
      page.getByText("Stock insuficiente para completar la operación"),
    ).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)

    const after = await readProduct(request, product.id)
    expect(Number(after.stock_current)).toBe(0)
  })

  test("Quick paid button creates the sale with a single full-total row", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Quick Pagado ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `QKP-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 5)
    const cashMethod = await getPaymentMethods(request)
    if (!cashMethod) throw new Error("Cash payment method not seeded")

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    // one click: no amount, no confirm dialog
    await payQuick(page, "Efectivo")

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""

    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.payments).toHaveLength(1)
    expect(sale?.payments[0].payment_method_id).toBe(cashMethod.id)
    expect(sale?.payments[0].monto).toBe("150.00")
  })

  test("Credit quick without a customer prompts and does not create a document", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const creditMethod = await createCreditPaymentMethod(
      request,
      `Cuenta Corriente ${suffix}`,
    )

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    // clear the auto-selected customer so no customer is selected
    await page.getByTestId("customer-select").click()
    await page.getByRole("option", { name: "Sin cliente" }).click()

    await payQuick(page, `Cuenta Corriente ${suffix}`)

    await expect(page.getByTestId("credit-customer-warning")).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)

    // no document was created through the credit method
    const docs = await readDocuments(request)
    const viaCredit = docs.filter((d) =>
      d.payments.some((p) => p.payment_method_id === creditMethod.id),
    )
    expect(viaCredit).toHaveLength(0)
  })

  test("Credit quick with a customer creates the credit sale", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Quick Crédito ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `QKC-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 5)
    const creditMethod = await createCreditPaymentMethod(
      request,
      `Cuenta Corriente ${suffix}`,
    )
    const customer = await createCustomer(
      request,
      `Cliente Quick Crédito ${suffix}`,
    )

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    await page.getByTestId("customer-select").click()
    await page
      .getByRole("option", { name: new RegExp(customer.razon_social) })
      .click()

    await payQuick(page, `Cuenta Corriente ${suffix}`)

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""

    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.payments).toHaveLength(1)
    expect(sale?.payments[0].payment_method_id).toBe(creditMethod.id)
    expect(sale?.payments[0].monto).toBe("150.00")

    // the full total stays on the customer's current account
    const customers = await api
      .get<{ id: string; saldo: string }>(
        request,
        "/customers/?skip=0&limit=1000",
      )
      .then((r) => r.data)
    const after = customers.find((c) => c.id === customer.id)
    expect(after?.saldo).toBe("150.00")
  })

  test("Split payment across two methods posts both rows", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Split Dos ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    // costo 100 with a 900% margin -> sale price 1000
    const product = await createProduct(request, {
      name,
      sku: `SPD-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 900,
    })
    await adjustStock(request, product.id, 5)
    const debitMethod = await createPaidPaymentMethod(
      request,
      `Débito ${suffix}`,
    )
    const cashMethod = await getPaymentMethods(request)
    if (!cashMethod) throw new Error("Cash payment method not seeded")

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    // row 0: cash 400
    await page.getByTestId("split-row-0-amount").fill("400")

    // row 1: debit 600
    await page.getByTestId("split-add-row").click()
    await page.getByTestId("split-row-1-method").click()
    await page
      .getByRole("option", { name: new RegExp(`Débito ${suffix}`) })
      .click()
    await page.getByTestId("split-row-1-amount").fill("600")

    await expect(page.getByTestId("split-covered")).toHaveText(
      "Cubierto: $1,000.00",
    )
    await expect(page.getByTestId("split-remaining")).toHaveText(
      "Restante: $0.00",
    )

    await page.getByTestId("split-confirm").click()

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""

    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.payments).toHaveLength(2)
    const cashRow = sale?.payments.find(
      (p) => p.payment_method_id === cashMethod.id,
    )
    const debitRow = sale?.payments.find(
      (p) => p.payment_method_id === debitMethod.id,
    )
    expect(cashRow?.monto).toBe("400.00")
    expect(debitRow?.monto).toBe("600.00")
  })

  test("Uncovered remainder blocks split confirmation", async ({ page }) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    await page.getByTestId("split-row-0-amount").fill("100")

    await expect(page.getByTestId("split-remaining")).toHaveText(
      "Restante: $50.00",
    )
    await expect(page.getByTestId("split-confirm")).toBeDisabled()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)
  })

  test("Credit overflow is blocked with credit_exceeds_total", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Split Crédito ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `SPC-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 900,
    })
    await adjustStock(request, product.id, 5)
    await createCreditPaymentMethod(request, `Cuenta Corriente ${suffix}`)
    const customer = await createCustomer(
      request,
      `Cliente Split Crédito ${suffix}`,
    )

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    await page.getByTestId("customer-select").click()
    await page
      .getByRole("option", { name: new RegExp(customer.razon_social) })
      .click()

    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    // cash 200 + credit 900 on a total of 1000: the credit overflows
    await page.getByTestId("split-row-0-amount").fill("200")
    await page.getByTestId("split-add-row").click()
    await page.getByTestId("split-row-1-method").click()
    await page
      .getByRole("option", { name: new RegExp(`Cuenta Corriente ${suffix}`) })
      .click()
    await page.getByTestId("split-row-1-amount").fill("900")

    await expect(page.getByTestId("split-confirm")).toBeDisabled()
    await expect(
      page.getByText("El crédito supera el total restante de la venta"),
    ).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)

    const docs = await readDocuments(request)
    const sales = docs.filter(
      (d) =>
        d.document_type.operation === "venta" &&
        d.lines.some((l) => l.product_name === name),
    )
    expect(sales).toHaveLength(0)
  })

  test("Non-cash overpayment is blocked with payment_exceeds_total", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Split Overpay ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `SPO-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 900,
    })
    await adjustStock(request, product.id, 5)
    await createPaidPaymentMethod(request, `Débito ${suffix}`)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    // debit 1100 on a total of 1000: no vuelto, blocked
    await page.getByTestId("split-row-0-method").click()
    await page
      .getByRole("option", { name: new RegExp(`Débito ${suffix}`) })
      .click()
    await page.getByTestId("split-row-0-amount").fill("1100")

    await expect(page.getByTestId("split-vuelto")).toHaveCount(0)
    await expect(page.getByTestId("split-confirm")).toBeDisabled()
    await expect(
      page.getByText("El pago supera el total de la venta"),
    ).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)
  })

  test("Cash overpayment shows vuelto, posts the capped row and carries it post-sale", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Vuelto ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `VUE-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 900,
    })
    await adjustStock(request, product.id, 5)
    const cashMethod = await getPaymentMethods(request)
    if (!cashMethod) throw new Error("Cash payment method not seeded")

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    // cash 1500 on a total of 1000 -> vuelto 500
    await page.getByTestId("split-row-0-amount").fill("1500")

    await expect(page.getByTestId("split-vuelto")).toHaveText("Vuelto: $500.00")
    await expect(page.getByTestId("split-confirm")).toBeEnabled()

    await page.getByTestId("split-confirm").click()

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""

    // the vuelto is carried into the post-sale view
    await expect(page.getByTestId("sale-vuelto")).toHaveText("Vuelto: $500.00")

    // only the effective (capped) amount is posted: 1000, never 1500
    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.payments).toHaveLength(1)
    expect(sale?.payments[0].payment_method_id).toBe(cashMethod.id)
    expect(sale?.payments[0].monto).toBe("1000.00")
  })

  test("Without an open session the payment controls are disabled", async ({
    page,
  }) => {
    await mockNoSession(page)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    // the quick buttons and the split entry are disabled...
    await expect(
      page.getByTestId("quick-pay-button").filter({ hasText: "Efectivo" }),
    ).toBeDisabled()
    await expect(page.getByTestId("split-payment-button")).toBeDisabled()

    // ...and the open-cash prompt is the visible call to action
    await expect(page.getByTestId("cash-register-bar")).toBeVisible()
    await expect(page.getByText("Caja cerrada")).toBeVisible()
    await expect(page.getByTestId("open-open-cash-dialog")).toBeVisible()
  })

  test("A cash_session_required slip-through is surfaced and the cart is preserved", async ({
    page,
    request,
  }) => {
    // the UI gate passes (mocked open session) but the real backend has no
    // open session -> the POST must fail with cash_session_required
    const session = await ensureOpenCashSession(request)
    await closeCashSession(request, session.id)
    await mockOpenSession(page)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    await payQuick(page, "Efectivo")

    await expect(
      page.getByText("Se necesita una caja abierta para registrar ventas"),
    ).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)

    // the cart was NOT reset by the failed mutation
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()
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

    // split dialog: favor toggle is auto-on, target drops to 50.00
    await page.getByTestId("split-payment-button").click()
    await expect(page.getByTestId("split-dialog")).toBeVisible()

    const favorLabel = page.getByText("Usar $100.00 de crédito a favor")
    await expect(favorLabel).toBeVisible()
    await expect(favorLabel.locator("input")).toBeChecked()

    await page.getByTestId("split-row-0-method").click()
    await page
      .getByRole("option", { name: new RegExp(`Cuenta Corriente ${suffix}`) })
      .click()
    await page.getByTestId("split-row-0-amount").fill("50")

    await expect(page.getByTestId("split-remaining")).toHaveText(
      "Restante: $0.00",
    )
    await page.getByTestId("split-confirm").click()

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

  test("Search keyboard navigation moves the highlight without wrapping", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const names = ["Alfa", "Beta", "Gamma"].map(
      (greek) => `NavProducto ${suffix} ${greek}`,
    )
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    for (const [i, name] of names.entries()) {
      await createProduct(request, {
        name,
        sku: `NAV-${suffix}-${i}`,
        uom_id: uom.id,
        costo_actual: 100,
        margen_pct: 50,
      })
    }

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(`NavProducto ${suffix}`)
    const options = page.getByTestId("search-option")
    await expect(options).toHaveCount(3)

    // the first suggestion starts highlighted; two ArrowDowns reach the third
    await expect(options.nth(0)).toHaveAttribute("data-highlighted", "true")
    await page.getByTestId("product-search").press("ArrowDown")
    await expect(options.nth(1)).toHaveAttribute("data-highlighted", "true")
    await page.getByTestId("product-search").press("ArrowDown")
    await expect(options.nth(2)).toHaveAttribute("data-highlighted", "true")

    // no wrap past the ends
    await page.getByTestId("product-search").press("ArrowDown")
    await expect(options.nth(2)).toHaveAttribute("data-highlighted", "true")
    await page.getByTestId("product-search").press("ArrowUp")
    await expect(options.nth(1)).toHaveAttribute("data-highlighted", "true")
    await page
      .getByTestId("product-search")
      .press("ArrowUp")
      .then(() => page.getByTestId("product-search").press("ArrowUp"))
    await expect(options.nth(0)).toHaveAttribute("data-highlighted", "true")
    await page.getByTestId("product-search").press("ArrowUp")
    await expect(options.nth(0)).toHaveAttribute("data-highlighted", "true")
  })

  test("Enter adds the highlighted suggestion exactly once and clears the input", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const names = ["Alfa", "Beta", "Gamma"].map(
      (greek) => `NavProducto ${suffix} ${greek}`,
    )
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    for (const [i, name] of names.entries()) {
      await createProduct(request, {
        name,
        sku: `NVE-${suffix}-${i}`,
        uom_id: uom.id,
        costo_actual: 100,
        margen_pct: 50,
      })
    }

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(`NavProducto ${suffix}`)
    const options = page.getByTestId("search-option")
    await expect(options).toHaveCount(3)

    // highlight the second suggestion and confirm with Enter
    await page.getByTestId("product-search").press("ArrowDown")
    await page.getByTestId("product-search").press("Enter")

    await expect(page.getByTestId("product-search")).toHaveValue("")
    const rows = page.getByRole("row").filter({ hasText: names[1] })
    await expect(rows).toHaveCount(1)
    await expect(
      page.getByRole("row").filter({ hasText: names[0] }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("row").filter({ hasText: names[2] }),
    ).toHaveCount(0)
  })

  test("Escape dismisses the suggestion list without adding anything", async ({
    page,
  }) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await expect(page.getByTestId("search-option").first()).toBeVisible()

    await page.getByTestId("product-search").press("Escape")

    await expect(page.getByTestId("search-option")).toHaveCount(0)
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)
  })

  test("A variant barcode scan adds that variant, not the base product", async ({
    page,
  }) => {
    // backend resolution is covered by backend tests; the UI contract here is
    // that a query exactly matching a variant barcode resolves the variant
    // (codes are UNIQUE) and adds it straight to the cart
    const variantBarcode = `888${uid()}2`
    const variantSuffix = `ROJO-${uid()}`
    await page.route("**/api/v1/products/search*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          count: 1,
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              name: "Producto E2E Con Variantes",
              sku: "VAR-BASE",
              uom_id: "22222222-2222-2222-2222-222222222222",
              is_active: true,
              margen_pct: "50",
              costo_actual: "100",
              precio_venta: "150",
              stock_current: "10",
              barcodes: [],
              taxes: [],
              uom: {
                id: "22222222-2222-2222-2222-222222222222",
                name: "unidad",
                abbreviation: "u",
                decimal_places: 0,
              },
              variants: [
                {
                  id: "33333333-3333-3333-3333-333333333333",
                  product_id: "11111111-1111-1111-1111-111111111111",
                  is_active: true,
                  sku_suffix: "AZUL",
                  stock_current: "5",
                  attribute_values: [],
                  barcodes: [],
                },
                {
                  id: "44444444-4444-4444-4444-444444444444",
                  product_id: "11111111-1111-1111-1111-111111111111",
                  is_active: true,
                  sku_suffix: variantSuffix,
                  stock_current: "5",
                  attribute_values: [],
                  barcodes: [
                    {
                      code: variantBarcode,
                      product_id: "11111111-1111-1111-1111-111111111111",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    )

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(variantBarcode)
    await page.getByTestId("product-search").press("Enter")

    // the resolved variant lands in the cart; the variant picker never opens
    const row = page.getByRole("row").filter({ hasText: variantSuffix })
    await expect(row).toBeVisible()
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)
  })

  test("Decimal-UoM product opens the quantity modal and accepts 0.25 at dp=3", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const uom = await api.post<{ id: string }>(request, "/uoms/", {
      name: `kg E2E ${suffix}`,
      abbreviation: "kg",
      decimal_places: 3,
    })
    const name = `Producto E2E Granel ${suffix}`
    const product = await createProduct(request, {
      name,
      sku: `GRV-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 200,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 10)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()

    // no auto-add: the modal asks for the hand-typed quantity
    const modal = page.getByTestId("qty-modal")
    await expect(modal).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0)

    await page.getByTestId("qty-modal-input").fill("0.25")
    await page.getByTestId("qty-modal-confirm").click()

    await expect(modal).toBeHidden()
    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row).toBeVisible()
    // columns: price, qty, discount — the qty spinbutton is the second
    await expect(row.getByRole("spinbutton").nth(1)).toHaveValue("0.25")

    // the fractional quantity reaches the document line
    await payQuick(page, "Efectivo")
    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""
    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(Number(sale?.lines[0].cantidad)).toBe(0.25)
  })

  test("Over-precision quantity is rejected at the UoM decimal places", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const uom = await api.post<{ id: string }>(request, "/uoms/", {
      name: `metro E2E ${suffix}`,
      abbreviation: "m",
      decimal_places: 2,
    })
    const name = `Producto E2E Metro ${suffix}`
    const product = await createProduct(request, {
      name,
      sku: `MTR-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 10)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()

    await expect(page.getByTestId("qty-modal")).toBeVisible()
    await page.getByTestId("qty-modal-input").fill("0.125")
    await page.getByTestId("qty-modal-confirm").click()

    // validation error, no cart line
    await expect(page.getByTestId("qty-modal-error")).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0)

    // a valid quantity still works afterwards
    await page.getByTestId("qty-modal-input").fill("1.5")
    await page.getByTestId("qty-modal-confirm").click()
    await expect(page.getByTestId("qty-modal")).toBeHidden()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()
  })

  test("Integer-UoM product keeps the auto-add 1 behavior", async ({
    page,
  }) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()

    await expect(page.getByTestId("qty-modal")).toHaveCount(0)
    const row = page.getByRole("row").filter({ hasText: productName })
    await expect(row).toBeVisible()
    await expect(row.getByRole("spinbutton").nth(1)).toHaveValue("1")
  })

  test("An unknown scan keeps the no-match empty state and the input", async ({
    page,
  }) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill("ZZZZNO SCAN MATCH")

    await expect(page.getByText("Sin productos que coincidan")).toBeVisible()
    await expect(page.getByTestId("product-search")).toHaveValue(
      "ZZZZNO SCAN MATCH",
    )
    await expect(page.getByTestId("sale-success-numero")).toHaveCount(0)
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

    // the split dialog auto-applies the credit in favor (target = 50.00)
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

    await page.getByTestId("split-payment-button").click()
    const favorLabel = page.getByText("Usar $100.00 de crédito a favor")
    await expect(favorLabel.locator("input")).toBeChecked()

    await page.getByTestId("split-row-0-amount").fill("50")
    await expect(page.getByTestId("split-remaining")).toHaveText(
      "Restante: $0.00",
    )

    await page.getByTestId("split-confirm").click()
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

  test("The post-sale dialog shows the summary and the vuelto", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const name = `Producto E2E Post Vuelto ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `PSV-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 900,
    })
    await adjustStock(request, product.id, 5)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible()

    // cash 1500 on a total of 1000 -> vuelto 500 in the dialog
    await page.getByTestId("split-payment-button").click()
    await page.getByTestId("split-row-0-amount").fill("1500")
    await page.getByTestId("split-confirm").click()

    const dialog = page.getByTestId("post-sale-dialog")
    await expect(dialog).toBeVisible()
    const numeroText = (
      await page.getByTestId("sale-success-numero").textContent()
    )?.trim()
    expect(numeroText).toMatch(/^\d{4}-F[ABC]-/)
    await expect(page.getByTestId("sale-vuelto")).toHaveText("Vuelto: $500.00")
    await expect(dialog.getByText(new RegExp(numeroText!))).toBeVisible()
  })

  test("The post-sale dialog omits the vuelto section for an exact payment", async ({
    page,
  }) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: productName }),
    ).toBeVisible()

    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await expect(page.getByTestId("sale-vuelto")).toHaveCount(0)
  })

  test("The note action PATCHes the document and prints on the voucher", async ({
    page,
    request,
  }) => {
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    const numeroText = (
      await page.getByTestId("sale-success-numero").textContent()
    )?.trim()
    const note = `Entrega en sucursal centro ${uid()}`

    await page.getByTestId("post-sale-note").fill(note)
    await page.getByTestId("post-sale-save-note").click()
    await expect(page.getByText("Nota guardada")).toBeVisible()

    // persisted through the PATCH endpoint
    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.notes).toBe(note)

    // the voucher re-renders with the note (local state update)
    await page.getByRole("button", { name: "Imprimir comprobante" }).click()
    await expect(page.getByTestId("voucher-notes")).toHaveText(note)
  })

  test("New sale resets the cart and refocuses the search input", async ({
    page,
    request,
  }) => {
    // own product: the shared fixture's stock is consumed by earlier tests
    const suffix = uid()
    const name = `Producto E2E Reset Venta ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `RSV-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 5)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await page.getByTestId("post-sale-new-sale").click()

    await expect(page.getByTestId("post-sale-dialog")).toHaveCount(0)
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0)
    await expect(page.getByTestId("product-search")).toBeFocused()
  })

  test("Print opens with the configured default format and toggles profiles", async ({
    page,
    request,
  }) => {
    await api.patch(request, "/business-settings/", {
      default_print_format: "ticket80",
    })
    // wait for the setting to be visible to a fresh page load
    await expect
      .poll(() =>
        api
          .getOne<{ default_print_format: string }>(
            request,
            "/business-settings/",
          )
          .then((s) => s.default_print_format),
      )
      .toBe("ticket80")

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await page.getByRole("button", { name: "Imprimir comprobante" }).click()

    // the settings default is the preselected profile
    const overlay = page.locator("[data-print-format]")
    await expect(overlay).toHaveAttribute("data-print-format", "ticket80")

    // switch to A4 for the same document
    await page.getByTestId("print-format-a4").click()
    await expect(overlay).toHaveAttribute("data-print-format", "a4")
    await page.getByTestId("print-format-ticket80").click()
    await expect(overlay).toHaveAttribute("data-print-format", "ticket80")

    await api.patch(request, "/business-settings/", {
      default_print_format: "a4",
    })
  })

  test("The save-PDF action opens the print flow with a hint", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.print = () => {
        ;(window as unknown as { __printed?: boolean }).__printed = true
      }
    })
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await page.getByTestId("post-sale-save-pdf").click()

    // same print dialog, with the save-as-PDF destination hint
    await expect(page.getByTestId("print-pdf-hint")).toBeVisible()
    await page.getByRole("button", { name: "Imprimir", exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __printed?: boolean }).__printed,
        ),
      )
      .toBe(true)
  })

  test("The voucher honors footer and legends settings in both profiles", async ({
    page,
    request,
  }) => {
    const footer = `Gracias por su compra ${uid()}`
    const legends = `Leyenda uno ${uid()}\nLeyenda dos ${uid()}`

    // NULL settings render nothing (fresh dev DB default)
    const patchPrintTexts = async (
      footerValue: string | null,
      legendsValue: string | null,
    ) => {
      await api.patch(request, "/business-settings/", {
        voucher_footer: footerValue,
        voucher_legends: legendsValue,
      })
    }
    await patchPrintTexts(null, null)
    await expect
      .poll(() =>
        api
          .getOne<{ voucher_footer: string | null }>(
            request,
            "/business-settings/",
          )
          .then((s) => s.voucher_footer),
      )
      .toBeNull()

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await page.getByRole("button", { name: "Imprimir comprobante" }).click()
    await expect(page.getByTestId("voucher-footer")).toHaveCount(0)

    // configure footer + legends; both profiles must render them
    await page.getByRole("button", { name: "Cerrar", exact: true }).click()
    await patchPrintTexts(footer, legends)
    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await payQuick(page, "Efectivo")
    await page.getByRole("button", { name: "Imprimir comprobante" }).click()

    await expect(page.getByTestId("voucher-footer")).toHaveText(footer)
    await expect(page.getByTestId("voucher-legends")).toContainText(
      legends.split("\n")[0],
    )
    await expect(page.getByTestId("voucher-legends")).toContainText(
      legends.split("\n")[1],
    )

    await page.getByTestId("print-format-ticket80").click()
    await expect(page.getByTestId("voucher-footer")).toHaveText(footer)

    await patchPrintTexts(null, null)
  })

  test("The email action is hidden without the document.email permission", async ({
    page,
  }) => {
    // a role without document.email: the action must not render at all
    await page.route("**/api/v1/users/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-00000000dead",
          email: "cashier@example.com",
          is_active: true,
          is_superuser: false,
          full_name: "Cajador Sin Permiso",
          roles: [],
        }),
      }),
    )

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await expect(page.getByTestId("post-sale-email")).toHaveCount(0)
  })

  test("The email action is disabled with a tooltip when SMTP is off", async ({
    page,
    request,
  }) => {
    // own product: the shared fixture's stock is consumed by earlier tests
    const suffix = uid()
    const name = `Producto E2E Email Off ${suffix}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const product = await createProduct(request, {
      name,
      sku: `EML-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 5)

    await page.route("**/api/v1/documents/email-status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ emails_enabled: false }),
      }),
    )

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    const email = page.getByTestId("post-sale-email")
    await expect(email).toBeDisabled()
    await expect(email).toHaveAttribute(
      "title",
      "El envío de emails está deshabilitado",
    )
  })

  test("The email action auto-sends to the customer's address", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const email = `cliente-${suffix}@example.com`
    const _customer = await api.post<{ id: string }>(request, "/customers/", {
      razon_social: `Cliente Email ${suffix}`,
      email,
    })

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await page.getByTestId("customer-select").click()
    await page
      .getByRole("option", { name: new RegExp(`Cliente Email ${suffix}`) })
      .click()
    await payQuick(page, "Efectivo")

    await expect(page.getByTestId("post-sale-dialog")).toBeVisible()
    await page.getByTestId("post-sale-email").click()

    // contraparte_email is on the document: no prompt, straight send
    await expect(page.getByText(`Comprobante enviado a ${email}`)).toBeVisible()

    // MailCatcher actually received it
    await expect
      .poll(async () => {
        const res = await request.get(
          `${process.env.MAILCATCHER_HOST ?? "http://localhost:1080"}/messages`,
        )
        const text = await res.text()
        return text.includes(email)
      })
      .toBe(true)
  })

  test("Cart keyboard: arrows select lines and +/-/Delete act on the selection", async ({
    page,
    request,
  }) => {
    const secondName = `Producto E2E Teclado ${uid()}`
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const second = await createProduct(request, {
      name: secondName,
      sku: `TEC-${uid().toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
    })
    await adjustStock(request, second.id, 500)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await page.getByTestId("product-search").fill(secondName)
    await page.getByRole("button", { name: new RegExp(secondName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: secondName }),
    ).toBeVisible()

    const rows = page.getByTestId("cart-row")
    await expect(rows).toHaveCount(2)

    // clicking a row selects it: aim at the product-name cell, not an input
    await rows.nth(0).getByText(productName).click()
    await expect(rows.nth(0)).toHaveAttribute("data-selected", "true")

    // arrows move the selection, no wrap in either direction
    await page.keyboard.press("ArrowDown")
    await expect(rows.nth(1)).toHaveAttribute("data-selected", "true")
    await page.keyboard.press("ArrowDown")
    await expect(rows.nth(1)).toHaveAttribute("data-selected", "true")
    await page.keyboard.press("ArrowUp")
    await expect(rows.nth(0)).toHaveAttribute("data-selected", "true")
    await page.keyboard.press("ArrowUp")
    await expect(rows.nth(0)).toHaveAttribute("data-selected", "true")

    // +/- adjust the selected integer-UoM line, clamped at 1 (never 0)
    const qty = rows.nth(0).getByRole("spinbutton").nth(1)
    await expect(qty).toHaveValue("1")
    await page.keyboard.press("+")
    await expect(qty).toHaveValue("2")
    await page.keyboard.press("-")
    await expect(qty).toHaveValue("1")
    await page.keyboard.press("-")
    await expect(qty).toHaveValue("1")

    // Delete removes the selected line without confirmation; the selection
    // lands on the remaining line
    await page.keyboard.press("Delete")
    await expect(rows).toHaveCount(1)
    await expect(rows.nth(0)).toHaveAttribute("data-selected", "true")
  })

  test("Action bar: +/- adjust, Descuento focuses the discount input, Eliminar removes", async ({
    page,
  }) => {
    await searchAndAdd(page)
    const rows = page.getByTestId("cart-row")

    // no selection: the bar is hidden
    await expect(page.getByTestId("cart-action-bar")).toHaveCount(0)

    await rows.nth(0).click()
    const bar = page.getByTestId("cart-action-bar")
    await expect(bar).toBeVisible()

    const qty = rows.nth(0).getByRole("spinbutton").nth(1)
    await page.getByTestId("cart-action-increase").click()
    await expect(qty).toHaveValue("2")
    await page.getByTestId("cart-action-decrease").click()
    await expect(qty).toHaveValue("1")

    await page.getByTestId("cart-action-discount").click()
    await expect(rows.nth(0).getByTestId("cart-discount-input")).toBeFocused()

    await page.getByTestId("cart-action-remove").click()
    await expect(page.getByTestId("cart-action-bar")).toHaveCount(0)
    await expect(rows).toHaveCount(0)
  })

  test("F2 confirms the sale with the first quick-payment shortcut", async ({
    page,
    request,
  }) => {
    // the F2 shortcut is whatever method the quick bar lists first; ensure
    // no explicit shortcut order is configured (suite default), polling
    // because other specs may be restoring the shared settings concurrently
    await api.patch(request, "/business-settings/", {
      sell_quick_method_ids: null,
    })
    await expect
      .poll(async () =>
        api
          .getOne<{ sell_quick_method_ids: string[] | null }>(
            request,
            "/business-settings/",
          )
          .then((s) => s.sell_quick_method_ids),
      )
      .toBe(null)
    const methods = await api
      .get<{ id: string; name: string }>(
        request,
        "/payment-methods/?skip=0&limit=100",
      )
      .then((r) => r.data)
    await searchAndAdd(page)
    // select the line via its name cell so keyboard focus stays off inputs
    await page.getByTestId("cart-row").getByText(productName).click()
    // F2 shares the quick buttons' gate: wait until the sale is confirmable
    // (cash session, customer and document type all resolved)
    await expect(page.getByTestId("quick-pay-button").first()).toBeEnabled()
    await page.keyboard.press("F2")

    const numero = page.getByTestId("sale-success-numero")
    await expect(numero).toBeVisible()
    const numeroText = (await numero.textContent())?.trim() ?? ""
    const docs = await readDocuments(request)
    const sale = docs.find((d) => d.numero === numeroText)
    expect(sale).toBeDefined()
    expect(sale?.payments).toHaveLength(1)
    expect(sale?.payments[0].payment_method_id).toBe(methods[0].id)
  })

  test("Enter reopens the quantity modal pre-filled on a selected decimal line", async ({
    page,
    request,
  }) => {
    const suffix = uid()
    const uom = await api.post<{ id: string }>(request, "/uoms/", {
      name: `kg E2E ${suffix}`,
      abbreviation: "kg",
      decimal_places: 3,
    })
    const name = `Producto E2E Granel Teclado ${suffix}`
    const product = await createProduct(request, {
      name,
      sku: `GRT-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 200,
      margen_pct: 50,
    })
    await adjustStock(request, product.id, 10)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(name)
    await page.getByRole("button", { name: new RegExp(name) }).click()
    await page.getByTestId("qty-modal-input").fill("0.5")
    await page.getByTestId("qty-modal-confirm").click()

    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row).toBeVisible()
    // select the line via its name cell so keyboard focus stays off inputs
    await row.getByText(name).click()

    await page.keyboard.press("Enter")
    const modal = page.getByTestId("qty-modal")
    await expect(modal).toBeVisible()
    await expect(page.getByTestId("qty-modal-input")).toHaveValue("0.5")

    await page.getByTestId("qty-modal-input").fill("1.25")
    await page.getByTestId("qty-modal-confirm").click()
    await expect(row.getByRole("spinbutton").nth(1)).toHaveValue("1.25")
  })

  test("Blocked price edit locks the price unless the product allows it", async ({
    page,
    request,
  }) => {
    // ensure the global block is ON (suite default); poll because other
    // specs may be restoring the shared settings concurrently
    await api.patch(request, "/business-settings/", {
      sell_block_price_edit: true,
    })
    await expect
      .poll(async () =>
        api
          .getOne<{ sell_block_price_edit: boolean }>(
            request,
            "/business-settings/",
          )
          .then((s) => s.sell_block_price_edit),
      )
      .toBe(true)

    const suffix = uid()
    const uoms = await getUoms(request)
    const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
    const allowedName = `Producto E2E Precio Libre ${suffix}`
    const allowed = await createProduct(request, {
      name: allowedName,
      sku: `PPL-${suffix.toUpperCase()}`,
      uom_id: uom.id,
      costo_actual: 100,
      margen_pct: 50,
      allow_price_edit_in_sale: true,
    })
    await adjustStock(request, allowed.id, 100)

    await page.goto("/sell")
    await page.getByTestId("product-search").fill(productName)
    await page.getByRole("button", { name: new RegExp(productName) }).click()
    await page.getByTestId("product-search").fill(allowedName)
    await page.getByRole("button", { name: new RegExp(allowedName) }).click()
    await expect(
      page.getByRole("row").filter({ hasText: allowedName }),
    ).toBeVisible()

    const rows = page.getByTestId("cart-row")
    // fixture product: flag defaults to False -> price locked
    await expect(rows.nth(0).getByRole("spinbutton").nth(0)).toBeDisabled()
    // flagged product: price stays editable
    await expect(rows.nth(1).getByRole("spinbutton").nth(0)).toBeEnabled()
    await expect(rows.nth(1).getByRole("spinbutton").nth(0)).toHaveValue("150")
  })
})
