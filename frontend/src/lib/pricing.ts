import type { PriceRounding, TaxPublic } from "@/client"

/** Mirror of the backend's `_round2` (Decimal ROUND_HALF_UP at 0.01). */
export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100

/**
 * Live client-side mirror of the backend pricing chain (crud.py
 * `_compute_precio_neto` / `_apply_price_rounding` / the góndola sum):
 *
 * - `precio_neto = round2(costo × (1 + margen/100))` — always exact 2 decimals.
 * - `precio_venta = round_mode(neto + neto × Σ percent rates/100 + Σ fixed)`.
 *   Fixed-amount taxes are added once, outside the divisor.
 * - `costo_con_impuestos = costo + round2(costo × IVA rate/100)`, 0 when the
 *   product has no percent IVA above 0% (exento marker included).
 */
export function computePriceChain({
  costo,
  margenPct,
  taxes,
  rounding,
}: {
  costo: number
  margenPct: number
  taxes: Pick<TaxPublic, "tipo" | "is_percent" | "rate">[]
  rounding?: PriceRounding
}) {
  const percentTotal = taxes
    .filter((tax) => tax.is_percent)
    .reduce((acc, tax) => acc + Number(tax.rate), 0)
  const fixedTotal = taxes
    .filter((tax) => !tax.is_percent)
    .reduce((acc, tax) => acc + Number(tax.rate), 0)
  const iva = taxes.find(
    (tax) => tax.tipo === "IVA" && tax.is_percent && Number(tax.rate) > 0,
  )

  const precioNeto = round2(costo * (1 + margenPct / 100))
  const rawVenta = precioNeto + precioNeto * (percentTotal / 100) + fixedTotal

  let precioVenta: number
  if (rounding === "psychological_90") {
    const candidate = Math.floor(rawVenta) + 0.9
    precioVenta = candidate < rawVenta ? candidate + 1 : candidate
  } else {
    // `none` and `two_decimals` both land on exact cents; the backend only
    // distinguishes them for reporting formatting.
    precioVenta = round2(rawVenta)
  }

  const costoConImpuestos = iva
    ? round2(costo + costo * (Number(iva.rate) / 100))
    : 0

  return { precioNeto, precioVenta, costoConImpuestos }
}

/**
 * Inverse of the chain's net-price step: derives the margin percentage from
 * a user-entered net price. `round2` keeps the derived margin at 2 decimals
 * (HALF_UP), matching the stored `margen_pct` scale. Returns 0 when the cost
 * is not positive (the ratio is undefined).
 */
export function margenPctFromNeto(costo: number, neto: number): number {
  if (costo <= 0) return 0
  return round2(((neto - costo) / costo) * 100)
}

/**
 * One percent-IVA-per-product guard (backend rule `multiple_iva_taxes`):
 * products may carry at most one tipo-IVA tax regardless of `exento`.
 */
export function countSelectedIvas(
  taxes: Pick<TaxPublic, "id" | "tipo">[],
  selectedIds: string[],
): number {
  const selected = new Set(selectedIds)
  return taxes.filter((tax) => tax.tipo === "IVA" && selected.has(tax.id))
    .length
}
