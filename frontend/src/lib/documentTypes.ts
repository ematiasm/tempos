/**
 * Resolving a seeded document type, in one place.
 *
 * `name` and `prefix` are both editable from the admin panel
 * (`PATCH /document-types/{id}`, exposed by `EditDocumentType`), so neither can identify a
 * seeded type. The buy screen used to look up `prefix === "OC"` and the stock screen
 * `prefix === "AJS"` — renaming either prefix took the screen down with it. `key` is
 * seed-managed and the API rejects any attempt to change it, so it is the only field a
 * screen may resolve a seeded type by.
 *
 * The contract is structural on purpose: a screen only needs the identity and whether the
 * type is active, so the helper stays a pure function that any type payload satisfies.
 */
export type KeyedDocumentType = {
  key?: string | null
  is_active: boolean
}

/**
 * The active type carrying `key`, or `undefined` when there is none.
 *
 * A deactivated type is never returned: it must not be offered for a new document, exactly
 * as the previous `is_active && prefix === ...` lookups required.
 */
export const findTypeByKey = <T extends KeyedDocumentType>(
  types: T[] | undefined,
  key: string,
): T | undefined => types?.find((type) => type.is_active && type.key === key)

/**
 * The types a user never creates by hand: a credit note is issued by voiding and a receipt has
 * its own flow. Matched by the stable key, because the prefixes this used to match are
 * editable — renaming `NCV` made credit notes manually creatable, and renaming `RC` hid
 * receipts from the dialog. A legacy type whose key was never backfilled stays creatable,
 * which is the same treatment an unrecognised type always had.
 */
const CREDIT_NOTE_TYPE_KEYS: ReadonlySet<string> = new Set([
  "nota_credito_venta",
  "nc_compra",
])
const RECEIPT_TYPE_KEYS: ReadonlySet<string> = new Set([
  "recibo_cobro",
  "recibo_pago",
])
const NON_CREATABLE_TYPE_KEYS: ReadonlySet<string> = new Set([
  ...CREDIT_NOTE_TYPE_KEYS,
  ...RECEIPT_TYPE_KEYS,
])

/** Whether this type may be picked when drafting a document by hand. */
export const isCreatableType = <T extends KeyedDocumentType>(
  type: T,
): boolean => type.key == null || !NON_CREATABLE_TYPE_KEYS.has(type.key)

/**
 * The receipt types a payment can be imputed to. Matched by key because the payments screen
 * used to list `prefix === "RC" || prefix === "RP"`, and renaming either emptied the list.
 *
 * A type without a key is not a receipt: every document type is seeded and the seed backfills
 * the key, so a NULL here means a row the seed could not recognise, which must not be
 * presented as a receipt a payment could be imputed to.
 */
export const isReceiptType = <T extends KeyedDocumentType>(type: T): boolean =>
  type.key != null && RECEIPT_TYPE_KEYS.has(type.key)

/**
 * The types the counter can sell. The sell screen and its settings both matched
 * `FA`/`FB`/`FC`/`TCK` by prefix, so renaming one removed it from the counter. The set is
 * deliberately curated rather than derived from the signs: a debit note shares `-1/+1` with a
 * sale and a remito is not a sale, and neither is offered at the counter.
 */
const COUNTER_SALE_TYPE_KEYS: ReadonlySet<string> = new Set([
  "factura_a",
  "factura_b",
  "factura_c",
  "ticket",
])

/** Whether this type may be sold from the counter. */
export const isCounterSaleType = <T extends KeyedDocumentType>(
  type: T,
): boolean => type.key != null && COUNTER_SALE_TYPE_KEYS.has(type.key)
