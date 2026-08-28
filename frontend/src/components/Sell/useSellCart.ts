import { useState } from "react"

import type { CartLine } from "./ProductSearch"
import { round2 } from "./paymentMath"

export function computeTotals(cart: CartLine[], discountTotal: number) {
  let subtotal = 0
  const perceptionsBase: { rate: number; isPercent: boolean }[] = []
  for (const line of cart) {
    const lineSubtotal = round2(
      line.qty * line.unitPrice * (1 - line.discountPct / 100),
    )
    subtotal = round2(subtotal + lineSubtotal)
    for (const tax of line.product.taxes ?? []) {
      if (tax.aplica_a === "documento") {
        perceptionsBase.push({
          rate: Number(tax.rate),
          isPercent: tax.is_percent === true,
        })
      }
    }
  }
  let perceptions = 0
  for (const p of perceptionsBase) {
    const monto = p.isPercent ? subtotal * (p.rate / 100) : p.rate
    perceptions = round2(perceptions + monto)
  }
  const total = round2(subtotal - discountTotal + perceptions)
  return { subtotal, perceptions, total }
}

export function useSellCart() {
  const [cart, setCart] = useState<CartLine[]>([])

  const addLine = (
    product: CartLine["product"],
    variant?: CartLine["variant"],
    qty = 1,
  ) => {
    const existing = cart.find(
      (l) =>
        l.product.id === product.id &&
        (l.variant?.id ?? null) === (variant?.id ?? null),
    )
    if (existing) {
      setCart((prev) =>
        prev.map((l) =>
          l === existing ? { ...l, qty: round2(l.qty + qty) } : l,
        ),
      )
    } else {
      setCart([
        ...cart,
        {
          product,
          variant,
          qty,
          unitPrice: Number(product.precio_venta),
          discountPct: 0,
        },
      ])
    }
  }

  const updateLine = (index: number, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    )
  }

  const removeLine = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index))
  }

  const reset = () => setCart([])

  return { cart, addLine, updateLine, removeLine, reset }
}
