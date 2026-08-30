import { expect, type Page } from "@playwright/test"

/**
 * Finds a table row by text, walking the client-side pagination. The dev DB
 * accumulates data across runs, so new rows are not always on the first page:
 * the rows-per-page selector is raised to 50 first to keep the walk short.
 *
 * Each page gets a short visibility poll instead of an instantaneous count
 * check: a count races the React render (clicks can outrun it, skipping the
 * page the row sits on) and a refetch swaps the data array, which TanStack
 * answers by resetting the table to its first page — both are absorbed by
 * re-polling the page and re-settling after the click.
 */
export const findRowInPages = async (page: Page, text: string) => {
  const row = page.getByRole("row").filter({ hasText: text })
  const firstRow = page.getByRole("row").first()
  const rowsPerPage = page.getByText("Rows per page").locator("..")
  const next = page.getByRole("button", { name: "Go to next page" })

  // The table header renders as soon as the data (or the empty state) is in;
  // its absence means the loading skeleton is still up.
  for (let wait = 0; wait < 50; wait++) {
    if ((await firstRow.count()) > 0) break
    await page.waitForTimeout(100)
  }

  if ((await rowsPerPage.count()) > 0) {
    await rowsPerPage.getByRole("combobox").click()
    await page.getByRole("option", { name: "50" }).click()
  }

  for (let page_ = 0; page_ < 12; page_++) {
    try {
      await expect(row).toBeVisible({ timeout: 1_000 })
      return row
    } catch {
      // Row not on this page (or a reset just re-rendered it away).
    }
    if ((await next.count()) === 0 || !(await next.isEnabled())) break
    await next.click()
    await page.waitForTimeout(250)
  }
  return row
}
