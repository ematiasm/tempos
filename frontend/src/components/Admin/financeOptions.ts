export function formatMoney(amount: string): string {
  const value = Number(amount)
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value)
}
