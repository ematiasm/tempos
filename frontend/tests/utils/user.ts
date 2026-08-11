import { expect, type Page } from "@playwright/test"

export async function signUpNewUser(
  page: Page,
  name: string,
  email: string,
  password: string,
) {
  await page.goto("/signup")

  await page.getByTestId("full-name-input").fill(name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByRole("button", { name: "Sign Up" }).click()
  await page.goto("/login")
}

export async function logInUser(page: Page, email: string, password: string) {
  await page.goto("/")
  await page
    .getByTestId("user-menu")
    .or(page.getByTestId("email-input"))
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => undefined)
  if (
    await page
      .getByTestId("user-menu")
      .isVisible()
      .catch(() => false)
  ) {
    await logOutUser(page)
  }
  await page.goto("/login")

  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Iniciar sesión" }).click()
  await page.waitForURL("/")
  await expect(
    page.getByText("Bienvenido de nuevo, ¡qué bueno verte!"),
  ).toBeVisible()
}

export async function logOutUser(page: Page) {
  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click()
  await page.goto("/login")
}
