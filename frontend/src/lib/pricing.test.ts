import { describe, expect, test } from "bun:test"
import type { TaxPublic, TaxType } from "@/client"
import {
  computePriceChain,
  countSelectedIvas,
  margenPctFromNeto,
} from "@/lib/pricing"

type ChainTax = Pick<TaxPublic, "tipo" | "is_percent" | "rate">
// `rate` arrives from the API as a decimal string, which is why the chain coerces it.
const tax = (tipo: TaxType, is_percent: boolean, rate: number): ChainTax => ({
  tipo,
  is_percent,
  rate: String(rate),
})
const iva21 = tax("IVA", true, 21)

describe("computePriceChain", () => {
  test("computes the net price from cost and margin", () => {
    const chain = computePriceChain({
      costo: 100,
      margenPct: 50,
      taxes: [iva21],
    })
    expect(chain.precioNeto).toBe(150)
    // 150 + 21% of 150
    expect(chain.precioVenta).toBe(181.5)
    expect(chain.costoConImpuestos).toBe(121)
  })

  test("adds every percent tax on the net and each fixed tax once", () => {
    const chain = computePriceChain({
      costo: 100,
      margenPct: 50,
      taxes: [iva21, tax("IIBB", true, 3), tax("Interno", false, 2)],
    })
    // 150 + 24% of 150 + 2
    expect(chain.precioVenta).toBe(188)
  })

  test("with no taxes the shelf price is the net price", () => {
    const chain = computePriceChain({ costo: 100, margenPct: 50, taxes: [] })
    expect(chain.precioNeto).toBe(150)
    expect(chain.precioVenta).toBe(150)
    expect(chain.costoConImpuestos).toBe(0)
  })

  test("an exempt product reports no tax on the cost", () => {
    // A 0% IVA row is the exento marker, and it must not count as the product's IVA.
    const chain = computePriceChain({
      costo: 100,
      margenPct: 50,
      taxes: [tax("IVA", true, 0)],
    })
    expect(chain.precioVenta).toBe(150)
    expect(chain.costoConImpuestos).toBe(0)
  })

  test("psychological_90 rounds up to the next .90 and never down", () => {
    const chain = computePriceChain({
      costo: 100,
      margenPct: 50,
      taxes: [iva21],
      rounding: "psychological_90",
    })
    expect(chain.precioVenta).toBe(181.9)
    // A raw price already ending in .90 stays there instead of moving to the next unit.
    const already = computePriceChain({
      costo: 100,
      margenPct: 50.6,
      taxes: [iva21],
      rounding: "psychological_90",
    })
    expect(already.precioNeto).toBe(150.6)
    expect(already.precioVenta).toBe(182.9)
  })

  test("rounding applies to the shelf price and never to the net", () => {
    const chain = computePriceChain({
      costo: 100,
      margenPct: 50,
      taxes: [iva21],
      rounding: "two_decimals",
    })
    expect(chain.precioNeto).toBe(150)
    expect(chain.precioVenta).toBe(181.5)
  })
})

describe("margenPctFromNeto", () => {
  test("inverts the chain's net step", () => {
    expect(margenPctFromNeto(100, 150)).toBe(50)
    expect(margenPctFromNeto(100, 133.33)).toBe(33.33)
  })

  test("answers zero when the cost makes the ratio undefined", () => {
    expect(margenPctFromNeto(0, 50)).toBe(0)
    expect(margenPctFromNeto(-10, 50)).toBe(0)
  })
})

describe("countSelectedIvas", () => {
  const taxes: Pick<TaxPublic, "id" | "tipo">[] = [
    { id: "iva1", tipo: "IVA" },
    { id: "iva2", tipo: "IVA" },
    { id: "iibb", tipo: "IIBB" },
  ]

  test("counts only the selected IVA taxes", () => {
    expect(countSelectedIvas(taxes, ["iva1", "iibb"])).toBe(1)
    expect(countSelectedIvas(taxes, ["iva1", "iva2"])).toBe(2)
    expect(countSelectedIvas(taxes, [])).toBe(0)
    expect(countSelectedIvas(taxes, ["iibb"])).toBe(0)
  })
})
