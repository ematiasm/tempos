import { expect, test } from "@playwright/test"
import {
  adjustStock,
  api,
  createProduct,
  createSale,
  getDocumentTypes,
  getUoms,
  readDocument,
  readDocuments,
} from "./utils/api"

const uid = () => Math.random().toString(36).substring(7)

test("Void a sale issuing its credit note", async ({ page, request }) => {
  const uoms = await getUoms(request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
  const productName = `Producto E2E Doc ${uid()}`
  const product = await createProduct(request, {
    name: productName,
    sku: `DOC-${uid().toUpperCase()}`,
    uom_id: uom.id,
    costo_actual: 100,
    margen_pct: 50,
  })
  await adjustStock(request, product.id, 5)
  const sale = await createSale(request, { productId: product.id })

  await page.goto("/documents")
  await page
    .getByPlaceholder("Buscar por número, tipo o contraparte...")
    .fill(sale.numero)

  const row = page.getByRole("row").filter({ hasText: sale.numero })
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: sale.numero }).click()

  const detail = page.getByRole("dialog")
  await expect(detail.getByText(sale.numero)).toBeVisible()
  await expect(detail.getByText("$150.00").first()).toBeVisible()

  await detail.getByRole("button", { name: "Anular documento" }).click()

  const voidDialog = page.getByRole("dialog")
  await expect(voidDialog.getByText(`Anular ${sale.numero}`)).toBeVisible()
  await voidDialog
    .getByRole("button", { name: "Emitir nota de crédito" })
    .click()

  await expect(
    page.getByText(/Nota de crédito \d{4}-NCV-.* emitida/),
  ).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  const original = await readDocument(request, sale.id)
  expect(original.estado).toBe("voided")

  const docs = await readDocuments(request)
  const nc = docs.find(
    (d) => d.document_type.prefix === "NCV" && d.parent_document_id === sale.id,
  )
  expect(nc).toBeDefined()
})

test("Create a sale from the documents panel", async ({ page, request }) => {
  const uoms = await getUoms(request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
  const productName = `Producto E2E Doc ${uid()}`
  const product = await createProduct(request, {
    name: productName,
    sku: `DOC-${uid().toUpperCase()}`,
    uom_id: uom.id,
    costo_actual: 100,
    margen_pct: 50,
  })
  await adjustStock(request, product.id, 5)

  await page.goto("/documents")
  await page.getByTestId("new-document-button").click()

  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Nuevo documento")).toBeVisible()

  await dialog.getByTestId("doc-type-select").click()
  await page.getByRole("option", { name: "Factura C (FC)" }).click()

  await dialog.getByTestId("product-search").fill(productName)
  await page.getByRole("button", { name: new RegExp(productName) }).click()
  await expect(
    dialog.getByRole("row").filter({ hasText: productName }),
  ).toBeVisible()

  await dialog.getByTestId("create-document-button").click()

  await expect(page.getByText(/Documento \d{4}-FC-.* creado/)).toBeVisible()
  const numero = (await dialog.locator("h3").textContent())?.trim() ?? ""
  expect(numero).toMatch(/^\d{4}-FC-\d{8}$/)

  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page
    .getByPlaceholder("Buscar por número, tipo o contraparte...")
    .fill(numero)
  await expect(page.getByRole("row").filter({ hasText: numero })).toBeVisible()
})

test("Filter documents by type and user", async ({ page, request }) => {
  const uoms = await getUoms(request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
  const product = await createProduct(request, {
    name: `Producto E2E Doc ${uid()}`,
    sku: `DOC-${uid().toUpperCase()}`,
    uom_id: uom.id,
  })
  await adjustStock(request, product.id, 5)
  const sale = await createSale(request, { productId: product.id })

  const customerId = sale.contraparte_id
  const types = await getDocumentTypes(request)
  const cot = types.find((t) => t.prefix === "COT" && t.is_active)
  if (!cot) throw new Error("COT document type not found")
  const quote = await api.post<{ id: string; numero: string }>(
    request,
    "/documents/",
    {
      document_type_id: cot.id,
      contraparte_id: customerId,
      lines: [{ product_id: product.id, cantidad: 1 }],
      payments: [],
    },
  )

  await page.goto("/documents")
  const rowSale = page.getByRole("row").filter({ hasText: sale.numero })
  const rowQuote = page.getByRole("row").filter({ hasText: quote.numero })
  await expect(rowSale).toBeVisible()
  await expect(rowQuote).toBeVisible()

  await page.getByTestId("doc-type-filter").click()
  await page.getByRole("option", { name: "Factura C (FC)" }).click()

  await expect(rowSale).toBeVisible()
  await expect(rowQuote).toHaveCount(0)

  const me = await api.getOne<{ full_name: string | null; email: string }>(
    request,
    "/users/me",
  )
  const superuserLabel = me.full_name ?? me.email
  await page.getByTestId("doc-user-filter").click()
  await page.getByRole("option", { name: superuserLabel }).click()

  await expect(rowSale).toBeVisible()
  await expect(rowQuote).toHaveCount(0)

  await page.getByTestId("clear-doc-filters").click()
  await expect(rowQuote).toBeVisible()
})
