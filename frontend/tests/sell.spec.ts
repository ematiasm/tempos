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
    await adjustStock(request, productId, 5)
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
    expect(Number(product.stock_current)).toBe(4)
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
})
