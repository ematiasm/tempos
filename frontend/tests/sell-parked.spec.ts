import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test"
import {
  adjustStock,
  createCustomer,
  createProduct,
  ensureOpenCashSession,
  getUoms,
} from "./utils/api"

// the close test mutates the shared cash session; keep this file's tests
// ordered like sell.spec.ts so they never race each other
test.describe.configure({ mode: "default" })

const PARKED_KEY = "tempos.sell.parked.v1"
const CART_SNAPSHOT_KEY = "tempos/sell/cart/v1"

const uid = () => Math.random().toString(36).substring(7)

/**
 * Clears the parked list and the cart snapshot before the FIRST page load of
 * the test: the sessionStorage marker survives reloads, so the persistence
 * test can reload without wiping the storage it is verifying.
 */
const cleanSellState = (page: Page) =>
  page.addInitScript(
    ([parkedKey, cartKey]) => {
      if (!sessionStorage.getItem("tempos-e2e-cleaned")) {
        sessionStorage.setItem("tempos-e2e-cleaned", "1")
        localStorage.removeItem(parkedKey)
        sessionStorage.removeItem(cartKey)
      }
    },
    [PARKED_KEY, CART_SNAPSHOT_KEY],
  )

const makeProduct = async (
  request: APIRequestContext,
  label: string,
): Promise<{ id: string; name: string }> => {
  const uoms = await getUoms(request)
  const uom = uoms.find((u) => u.name === "unidad") ?? uoms[0]
  const suffix = uid()
  const name = `Producto E2E ${label} ${suffix}`
  const product = await createProduct(request, {
    name,
    sku: `PRK-${suffix.toUpperCase()}`,
    uom_id: uom.id,
    costo_actual: 100,
    margen_pct: 50,
  })
  await adjustStock(request, product.id, 50)
  return product
}

const addToCart = async (page: Page, name: string) => {
  await page.getByTestId("product-search").fill(name)
  await page.getByRole("button", { name: new RegExp(name) }).click()
  const rows = page.getByTestId("cart-row")
  await expect(rows).toHaveCount(1)
  return rows
}

const openParkedList = async (page: Page) => {
  await page.getByTestId("parked-sales-toggle").click()
  await expect(page.getByTestId("parked-sale-row").first()).toBeVisible()
  return page.getByTestId("parked-sale-row")
}

test.describe("Sell parked sales", () => {
  test.beforeAll(async ({ request }) => {
    await ensureOpenCashSession(request)
  })

  test.afterEach(async ({ request }) => {
    // the close test closes the session; it must not leak to the other tests
    await ensureOpenCashSession(request)
  })

  test("Parking a sale resets the screen and stores the sale", async ({
    page,
    request,
  }) => {
    await cleanSellState(page)
    const product = await makeProduct(request, "Park Simple")
    await page.goto("/sell")
    await addToCart(page, product.name)

    await page.getByTestId("park-sale").click()

    await expect(page.getByTestId("cart-row")).toHaveCount(0)
    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")
    await expect(page.getByText("Venta guardada")).toBeVisible()
  })

  test("Recalling a parked sale swaps it with the active one", async ({
    page,
    request,
  }) => {
    await cleanSellState(page)
    const product = await makeProduct(request, "Park Swap")
    const customer = await createCustomer(request, `Cliente Park Swap ${uid()}`)

    await page.goto("/sell")
    await addToCart(page, product.name)
    await page.getByTestId("customer-select").click()
    await page
      .getByRole("option", { name: new RegExp(customer.razon_social) })
      .click()
    await page.getByTestId("park-sale").click()
    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")

    // start a second sale, then recall the first: the second auto-parks
    await addToCart(page, product.name)
    const rows = await openParkedList(page)
    await rows.first().getByTestId("parked-sale-recall").click()

    await expect(page.getByTestId("cart-row")).toContainText(product.name)
    await expect(page.getByTestId("customer-select")).toContainText(
      customer.razon_social,
    )
    // zero-friction swap: the active sale parked, so the count returns to 1
    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")
  })

  test("Discarding a parked sale with items asks for confirmation", async ({
    page,
    request,
  }) => {
    await cleanSellState(page)
    const product = await makeProduct(request, "Park Descarte")

    await page.goto("/sell")
    await addToCart(page, product.name)
    await page.getByTestId("park-sale").click()

    const rows = await openParkedList(page)
    await rows.first().getByTestId("parked-sale-discard").click()

    const confirm = page.getByTestId("parked-sale-discard-confirm")
    await expect(confirm).toBeVisible()
    await confirm.click()

    await expect(page.getByTestId("parked-sale-row")).toHaveCount(0)
    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(0)")
  })

  test("Discarding an empty parked sale skips confirmation", async ({
    page,
  }) => {
    await cleanSellState(page)
    // the UI can only produce entries with items; seed a snapshot-free one
    // through storage to pin the no-confirmation contract
    await page.addInitScript(
      ([parkedKey]) => {
        localStorage.setItem(
          parkedKey,
          JSON.stringify({
            version: 1,
            parked: [
              {
                id: "e2e-empty-entry",
                parkedAt: new Date().toISOString(),
                customerName: null,
                snapshot: {
                  version: 1,
                  cart: [],
                  customerId: null,
                  customerTouched: false,
                  docTypeId: null,
                  date: new Date().toISOString().slice(0, 10),
                  discountTotal: 0,
                  notes: "",
                },
              },
            ],
          }),
        )
      },
      [PARKED_KEY],
    )

    await page.goto("/sell")
    const rows = await openParkedList(page)
    await expect(rows).toHaveCount(1)

    await rows.first().getByTestId("parked-sale-discard").click()

    await expect(page.getByTestId("parked-sale-discard-confirm")).toHaveCount(0)
    await expect(page.getByTestId("parked-sale-row")).toHaveCount(0)
  })

  test("Parked sales survive a reload", async ({ page, request }) => {
    await cleanSellState(page)
    const product = await makeProduct(request, "Park Persiste")

    await page.goto("/sell")
    await addToCart(page, product.name)
    await page.getByTestId("park-sale").click()
    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")

    await page.reload()

    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")
    const rows = await openParkedList(page)
    await rows.first().getByTestId("parked-sale-recall").click()
    await expect(page.getByTestId("cart-row")).toContainText(product.name)
  })

  test("Alt+P parks and Alt+1 recalls", async ({ page, request }) => {
    await cleanSellState(page)
    const product = await makeProduct(request, "Park Teclas")

    await page.goto("/sell")
    await addToCart(page, product.name)
    // move focus off any input so the global shortcut fires
    await page.getByTestId("cart-row").getByText(product.name).click()
    await page.keyboard.press("Alt+p")

    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")
    await expect(page.getByTestId("cart-row")).toHaveCount(0)

    // Alt+1 works with an EMPTY active cart: it recalls the parked sale
    await page.keyboard.press("Alt+1")

    await expect(page.getByTestId("cart-row")).toContainText(product.name)
    await expect(page.getByText("Venta recuperada")).toBeVisible()
  })

  test("Close cash is blocked by open sales until they are discarded", async ({
    page,
    request,
  }) => {
    await cleanSellState(page)
    const product = await makeProduct(request, "Park Cierre")

    await page.goto("/sell")
    await addToCart(page, product.name)
    await page.getByTestId("park-sale").click()
    await expect(page.getByTestId("parked-sales-toggle")).toContainText("(1)")

    await page.getByTestId("open-close-cash-dialog").click()
    await expect(page.getByTestId("cash-open-sales-warning")).toBeVisible()
    await page.getByTestId("cash-counted-amount").fill("0")
    await expect(page.getByTestId("cash-close-submit")).toBeDisabled()

    await page.getByTestId("cash-discard-open-sales").click()
    await expect(page.getByTestId("cash-close-submit")).toBeEnabled()
    await page.getByTestId("cash-close-submit").click()
    await expect(page.getByText("Caja cerrada correctamente")).toBeVisible()
  })
})
