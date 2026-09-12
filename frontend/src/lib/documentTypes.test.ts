import { describe, expect, test } from "bun:test"

import {
  findTypeByKey,
  isCounterSaleType,
  isCreatableType,
  isReceiptType,
} from "@/lib/documentTypes"

/**
 * `name` and `prefix` are both editable from the admin panel, so neither can identify a
 * seeded document type: the buy screen used to look up `prefix === "OC"`, and renaming that
 * prefix took the whole screen down with it. `key` is seed-managed and never editable, so it
 * is the only field a screen may resolve a seeded type by.
 */
describe("findTypeByKey", () => {
  test("resolves the type carrying the key", () => {
    const types = [
      { key: "factura_a", is_active: true },
      { key: "orden_compra", is_active: true },
    ]
    expect(findTypeByKey(types, "orden_compra")).toBe(types[1])
  })

  test("ignores a deactivated type, which must not be offered", () => {
    const types = [{ key: "orden_compra", is_active: false }]
    expect(findTypeByKey(types, "orden_compra")).toBeUndefined()
  })

  test("does not resolve a type by its key when the key is missing", () => {
    const types = [{ key: null, is_active: true }, { is_active: true }]
    expect(findTypeByKey(types, "orden_compra")).toBeUndefined()
  })

  test("answers undefined for an unknown key and for no data at all", () => {
    expect(
      findTypeByKey([{ key: "ticket", is_active: true }], "remito"),
    ).toBeUndefined()
    expect(findTypeByKey(undefined, "remito")).toBeUndefined()
    expect(findTypeByKey([], "remito")).toBeUndefined()
  })

  test("survives a type whose name and prefix were renamed", () => {
    // The exact scenario that used to break: same key, different editable fields.
    const renamed = {
      key: "orden_compra",
      name: "Compra",
      prefix: "CMP",
      is_active: true,
    }
    expect(findTypeByKey([renamed], "orden_compra")).toBe(renamed)
  })

  test("resolves every key the screens depend on, out of the full seeded set", () => {
    // Pins the contract each screen relies on against the backend seed, so a key
    // renamed on one side fails here instead of in a screen nobody opened yet.
    const seeded = [
      "factura_a",
      "factura_b",
      "factura_c",
      "ticket",
      "cotizacion",
      "nota_credito_venta",
      "nota_debito_venta",
      "orden_compra",
      "nc_compra",
      "nd_compra",
      "remito",
      "ajuste_stock",
      "recibo_cobro",
      "recibo_pago",
    ].map((key) => ({ key, is_active: true }))

    expect(findTypeByKey(seeded, "orden_compra")?.key).toBe("orden_compra")
    expect(findTypeByKey(seeded, "ajuste_stock")?.key).toBe("ajuste_stock")
    expect(findTypeByKey(seeded, "no_existe")).toBeUndefined()
  })
})

/**
 * Credit notes are issued by voiding and receipts have their own screens, so neither may be
 * offered for manual creation. The dialog used to match their *prefixes*, which are editable:
 * renaming `NCV` made credit notes manually creatable, and renaming `RC` hid receipts.
 */
describe("isCreatableType", () => {
  test("refuses the types that are issued by another flow", () => {
    const creditNote = { key: "nota_credito_venta", is_active: true }
    const purchaseCreditNote = { key: "nc_compra", is_active: true }
    const collection = { key: "recibo_cobro", is_active: true }
    const payment = { key: "recibo_pago", is_active: true }

    expect(isCreatableType(creditNote)).toBe(false)
    expect(isCreatableType(purchaseCreditNote)).toBe(false)
    expect(isCreatableType(collection)).toBe(false)
    expect(isCreatableType(payment)).toBe(false)
  })

  test("offers every type a user creates by hand", () => {
    const invoice = { key: "factura_a", is_active: true }
    const ticket = { key: "ticket", is_active: true }
    const quote = { key: "cotizacion", is_active: true }
    const purchase = { key: "orden_compra", is_active: true }
    const adjustment = { key: "ajuste_stock", is_active: true }

    expect(isCreatableType(invoice)).toBe(true)
    expect(isCreatableType(ticket)).toBe(true)
    expect(isCreatableType(quote)).toBe(true)
    expect(isCreatableType(purchase)).toBe(true)
    expect(isCreatableType(adjustment)).toBe(true)
  })

  test("keeps refusing them after their editable prefix is renamed", () => {
    const renamedCreditNote = {
      key: "nota_credito_venta",
      name: "Nota de Crédito (renamed)",
      prefix: "XYZ",
      is_active: true,
    }
    expect(isCreatableType(renamedCreditNote)).toBe(false)
  })
})

/**
 * The payments screen lists the documents a receipt can be imputed to. It matched `RC`/`RP`
 * by prefix, so renaming either prefix silently emptied the list.
 */
describe("isReceiptType", () => {
  test("recognises both receipt directions", () => {
    expect(isReceiptType({ key: "recibo_cobro", is_active: true })).toBe(true)
    expect(isReceiptType({ key: "recibo_pago", is_active: true })).toBe(true)
  })

  test("rejects every other type, including the credit notes", () => {
    const other = [
      "factura_a",
      "ticket",
      "nota_credito_venta",
      "nc_compra",
      "remito",
    ]
    for (const key of other) {
      expect(isReceiptType({ key, is_active: true })).toBe(false)
    }
    expect(isReceiptType({ key: null, is_active: true })).toBe(false)
    expect(isReceiptType({ is_active: true })).toBe(false)
  })

  test("still recognises a receipt whose editable prefix was renamed", () => {
    expect(
      isReceiptType({
        key: "recibo_cobro",
        name: "Cobranza",
        prefix: "CB",
        is_active: true,
      }),
    ).toBe(true)
  })
})

/**
 * The types the counter can sell. The sell screen and its settings both matched
 * `FA`/`FB`/`FC`/`TCK` by prefix, so renaming one removed it from the counter.
 */
describe("isCounterSaleType", () => {
  test("offers the fiscal invoices and the ticket", () => {
    const saleTypes = ["factura_a", "factura_b", "factura_c", "ticket"]
    for (const key of saleTypes) {
      expect(isCounterSaleType({ key, is_active: true })).toBe(true)
    }
  })

  test("leaves out the types the counter does not issue", () => {
    // A credit note comes from voiding, a remito is not a sale, and a purchase is
    // not sold: the previous prefix list excluded exactly these.
    const excluded = [
      "nota_credito_venta",
      "nota_debito_venta",
      "remito",
      "orden_compra",
      "cotizacion",
    ]
    for (const key of excluded) {
      expect(isCounterSaleType({ key, is_active: true })).toBe(false)
    }
    expect(isCounterSaleType({ key: null, is_active: true })).toBe(false)
    expect(isCounterSaleType({ is_active: true })).toBe(false)
  })

  test("still offers a sale type whose editable name and prefix were renamed", () => {
    expect(
      isCounterSaleType({
        key: "factura_a",
        name: "Comprobante",
        prefix: "XX",
        is_active: true,
      }),
    ).toBe(true)
  })
})
