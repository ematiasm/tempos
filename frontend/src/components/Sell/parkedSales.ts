import {
  isSnapshotShape,
  loadCartSnapshot,
  type SellCartSnapshot,
} from "./useSellCart"

// --- Parked sales (localStorage) --------------------------------------------
// Parked ("Guardar venta") sales persist in localStorage so they survive tab
// closes and reloads; they are intentionally scoped to the whole browser,
// unlike the ACTIVE in-progress sale which stays on sessionStorage (tab
// isolation is deliberate — see the snapshot block in useSellCart.ts).

/** Versioned storage key: a shape change requires bumping the suffix. */
export const PARKED_SALES_KEY = "tempos.sell.parked.v1"

const PARKED_VERSION = 1

/** Window event fired on every parked-list mutation so UI can re-read. */
export const PARKED_CHANGED_EVENT = "tempos:sell:parked-changed"

/**
 * Window event fired when a surface outside the sell screen (e.g. the
 * close-cash dialog's "discard all") wipes parked sales and the in-flight
 * snapshot; the sell screen listens and resets its state to the defaults.
 */
export const SELL_EXTERNAL_RESET_EVENT = "tempos:sell:external-reset"

/** A parked sale: the persisted snapshot plus display metadata, resolved
 * at park time so the list renders without extra lookups. */
export interface ParkedSale {
  id: string
  parkedAt: string
  /** Denormalized for display; null when the customer was the default flow. */
  customerName: string | null
  snapshot: SellCartSnapshot
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** True when the parsed value has the persisted parked entry's shape. */
const isParkedSaleShape = (value: unknown): value is ParkedSale => {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.parkedAt === "string" &&
    (value.customerName === null || typeof value.customerName === "string") &&
    isSnapshotShape(value.snapshot)
  )
}

export const newParkedId = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const notifyChanged = (): void => {
  window.dispatchEvent(new CustomEvent(PARKED_CHANGED_EVENT))
}

/** Defensive read: garbage, unknown versions and malformed entries are dropped. */
export const readParkedSales = (): ParkedSale[] => {
  try {
    const raw = localStorage.getItem(PARKED_SALES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      parsed.version !== PARKED_VERSION ||
      !Array.isArray(parsed.parked)
    ) {
      return []
    }
    return parsed.parked.filter(isParkedSaleShape)
  } catch {
    return []
  }
}

export const saveParkedSales = (parked: ParkedSale[]): void => {
  try {
    localStorage.setItem(
      PARKED_SALES_KEY,
      JSON.stringify({ version: PARKED_VERSION, parked }),
    )
  } catch {
    // storage unavailable (private mode, quota): parking degrades silently
  }
  notifyChanged()
}

/** Prepends the entry so the list reads newest-first. */
export const addParkedSale = (entry: ParkedSale): void => {
  saveParkedSales([entry, ...readParkedSales()])
}

export const removeParkedSale = (id: string): void => {
  saveParkedSales(readParkedSales().filter((entry) => entry.id !== id))
}

export const clearParkedSales = (): void => {
  try {
    localStorage.removeItem(PARKED_SALES_KEY)
  } catch {
    // nothing to clean up when storage is unavailable
  }
  notifyChanged()
}

/**
 * Open sales for the close-cash gate: the parked list plus whether the
 * ACTIVE in-progress sale (sessionStorage snapshot) still has cart lines.
 */
export const countOpenSales = (): {
  parkedCount: number
  activeHasItems: boolean
} => {
  const snapshot = loadCartSnapshot()
  return {
    parkedCount: readParkedSales().length,
    activeHasItems: snapshot != null && snapshot.cart.length > 0,
  }
}

/** Convenience wrapper used by the sell screen when parking a sale. */
export const makeParkedSale = (
  snapshot: Omit<SellCartSnapshot, "version">,
  customerName: string | null,
): ParkedSale => ({
  id: newParkedId(),
  parkedAt: new Date().toISOString(),
  customerName,
  snapshot: { version: 1, ...snapshot },
})
