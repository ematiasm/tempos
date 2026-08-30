import type { Page } from "@playwright/test"

/**
 * Finds a table row by text, walking the client-side pagination. The dev DB
 * accumulates data across runs, so new rows are not always on the first page:
 * the rows-per-page selector is raised to 50 first to keep the walk short.
 */
export const findRowInPages = async (page: Page, text: string) => {
  const rowsPerPage = page.getByText("Rows per page").locator("..")
  if ((await rowsPerPage.count()) > 0) {
    await rowsPerPage.getByRole("combobox").click()
    await page.getByRole("option", { name: "50" }).click()
  }
  for (let i = 0; i < 60; i++) {
    const row = page.getByRole("row").filter({ hasText: text })
    if ((await row.count()) > 0) return row
    const next = page.getByRole("button", { name: "Go to next page" })
    // No pagination control at all (small table): nothing left to walk.
    if ((await next.count()) === 0 || !(await next.isEnabled())) break
    await next.click()
  }
  return page.getByRole("row").filter({ hasText: text })
}
