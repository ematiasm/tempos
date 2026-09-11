import { type APIRequestContext, expect, test } from "@playwright/test"
import {
  adjustStock,
  createCustomer,
  createProduct,
  createSale,
  getUoms,
  readDocuments,
  readOutstanding,
  readReceiptAllocations,
} from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

test.describe
  .serial("Payments flow", () => {
    let customerName: string
    let customerId: string
    let productId: string

    // the request fixture must flow through: createSale issues the API call
    const issueUnpaidSale = (request: APIRequestContext) => {
      return createSale(request, {
        productId,
        customerId,
        price: 150,
        paid: false,
      })
    }

    test.beforeAll(async ({ request }) => {
      const uoms = await getUoms(request)
      const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
      const product = await createProduct(request, {
        name: `Producto E2E Pago ${uid()}`,
        sku: `PAG-${uid().toUpperCase()}`,
        uom_id: uom.id,
        costo_actual: 100,
        margen_pct: 50,
      })
      productId = product.id
      await adjustStock(request, productId, 5)

      customerName = `Cliente E2E Pago ${uid()}`
      const customer = await createCustomer(request, customerName)
      customerId = customer.id
    })

    test("Collect an unpaid sale from the counterpart sheet", async ({
      page,
      request,
    }) => {
      const sale = await issueUnpaidSale(request)

      await page.goto("/customers")
      // the dev DB accumulates customers across runs: filter instead of
      // assuming the new customer is on the table's first page
      await page
        .getByPlaceholder("Buscar por nombre, documento o teléfono...")
        .fill(customerName)
      await page.getByRole("row").filter({ hasText: customerName }).click()
      // the sheet opens from the customer-name button inside the row
      await page.getByRole("button", { name: customerName }).click()
      await expect(page.getByTestId("receipt-open")).toBeVisible()

      await page.getByTestId("receipt-open").click()
      await expect(
        page.getByText("Documentos pendientes", { exact: true }),
      ).toBeVisible()
      await expect(
        page.locator("li").filter({ hasText: sale.numero }),
      ).toBeVisible()
      await expect(page.getByTestId("receipt-amount")).toHaveValue("150")

      await page.getByTestId("receipt-submit").click()

      await expect(page.getByText(/Recibo \d{4}-RC-/)).toBeVisible()

      await expect(page.getByTestId("receipt-open")).toBeHidden()

      const docs = await readDocuments(request)
      const receipt = docs.find((d) => d.document_type.prefix === "RC")
      expect(receipt).toBeDefined()

      const outstanding = await readOutstanding(request, "customer", customerId)
      expect(outstanding).toHaveLength(0)
    })

    test("Issue a receipt from the Payments section", async ({
      page,
      request,
    }) => {
      await issueUnpaidSale(request)

      await page.goto("/payments")
      await page.getByRole("button", { name: "Nuevo recibo" }).click()

      await page.getByTestId("receipt-party-select").click()
      await page.getByRole("option", { name: customerName }).click()
      await expect(page.getByTestId("receipt-amount")).toHaveValue("150")

      await page.getByTestId("receipt-submit").click()
      await expect(page.getByText(/Recibo \d{4}-RC-/)).toBeVisible()

      await expect(
        page
          .getByRole("row")
          .filter({ hasText: customerName })
          // earlier tests in this serial group already issued receipts for
          // the same customer: any receipt row listing them proves visibility
          .first(),
      ).toBeVisible()
    })

    test("Partial receipt keeps the remainder outstanding", async ({
      page,
      request,
    }) => {
      await issueUnpaidSale(request)

      await page.goto("/payments")
      await page.getByRole("button", { name: "Nuevo recibo" }).click()

      await page.getByTestId("receipt-party-select").click()
      await page.getByRole("option", { name: customerName }).click()

      await page.getByTestId("receipt-amount").fill("50")
      await page.getByTestId("receipt-submit").click()

      await expect(page.getByText(/Recibo \d{4}-RC-/)).toBeVisible()

      const outstanding = await readOutstanding(request, "customer", customerId)
      expect(outstanding).toHaveLength(1)
      expect(Number(outstanding[0].pendiente)).toBeCloseTo(100, 2)

      const docs = await readDocuments(request)
      const receipt = docs
        .filter((d) => d.document_type.prefix === "RC")
        .find((d) => d.payments.some((p) => Number(p.monto) === 50))
      expect(receipt).toBeDefined()

      const allocations = await readReceiptAllocations(request, receipt!.id)
      expect(Number(allocations[0].monto)).toBeCloseTo(50, 2)
    })
  })
