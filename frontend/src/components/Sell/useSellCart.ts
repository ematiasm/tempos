import { useState } from "react"
import { round2 } from "@/lib/money"
import type { CartLine } from "./ProductSearch"

// Quantity helpers live in `@/lib/quantities` (shared with the purchase
// entry); re-exported here so existing sell import sites keep working.
export { clampQty, minQtyFor, qtyStepFor } from "@/lib/quantities"

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

  /** Replaces the whole cart (used by the snapshot restore after a reload). */
  const restore = (lines: CartLine[]) => setCart(lines)

  return { cart, addLine, updateLine, removeLine, reset, restore }
}

// --- Cart snapshot (sessionStorage) ----------------------------------------
// Versioned snapshot of an in-progress sale. sessionStorage survives an
// accidental reload (and Ctrl+Shift+T) but NOT a tab close+reopen — that
// scope is a deliberate decision; never swap it for localStorage.

export const CART_SNAPSHOT_KEY = "tempos/sell/cart/v1"

export interface SellCartSnapshot {
  version: 1
  cart: CartLine[]
  customerId: string | null
  customerTouched: boolean
  docTypeId: string | null
  date: string
  discountTotal: number
  notes: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isCartLineShape = (value: unknown): value is CartLine => {
  if (!isRecord(value)) return false
  if (!isRecord(value.product) || typeof value.product.id !== "string") {
    return false
  }
  if (
    value.variant != null &&
    (!isRecord(value.variant) || typeof value.variant.id !== "string")
  ) {
    return false
  }
  return (
    typeof value.qty === "number" &&
    Number.isFinite(value.qty) &&
    typeof value.unitPrice === "number" &&
    Number.isFinite(value.unitPrice) &&
    typeof value.discountPct === "number" &&
    Number.isFinite(value.discountPct)
  )
}

/** True when the parsed value has the persisted snapshot's shape. Exported
 * so the parked-sales storage can validate its embedded snapshots too. */
export const isSnapshotShape = (value: unknown): value is SellCartSnapshot => {
  if (!isRecord(value) || value.version !== 1) return false
  if (!Array.isArray(value.cart) || !value.cart.every(isCartLineShape)) {
    return false
  }
  if (value.customerId !== null && typeof value.customerId !== "string") {
    return false
  }
  if (typeof value.customerTouched !== "boolean") return false
  if (value.docTypeId !== null && typeof value.docTypeId !== "string") {
    return false
  }
  return (
    typeof value.date === "string" &&
    typeof value.notes === "string" &&
    typeof value.discountTotal === "number" &&
    Number.isFinite(value.discountTotal)
  )
}

export const saveCartSnapshot = (snapshot: SellCartSnapshot): void => {
  try {
    sessionStorage.setItem(CART_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // storage unavailable (private mode, quota): selling continues unaided
  }
}

/** Defensive read: garbage, unknown versions and malformed shapes return null. */
export const loadCartSnapshot = (): SellCartSnapshot | null => {
  try {
    const raw = sessionStorage.getItem(CART_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSnapshotShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const clearCartSnapshot = (): void => {
  try {
    sessionStorage.removeItem(CART_SNAPSHOT_KEY)
  } catch {
    // nothing to clean up when storage is unavailable
  }
}
