/** Quantity helpers bound to the product UoM decimal precision.

Shared by the sell cart and the purchase entry: both clamp steppers and
manual inputs through these so a line can never carry more decimals than
its UoM allows (the backend rejects those with `line_qty_precision`).
*/

/** Sensible minimum quantity: the smallest amount the UoM can represent. */
export const minQtyFor = (decimalPlaces: number): number =>
  decimalPlaces > 0 ? 1 / 10 ** decimalPlaces : 1

/** Keyboard / action-bar step: 1 for integer UoMs, 0.1 for decimal ones. */
export const qtyStepFor = (decimalPlaces: number): number =>
  decimalPlaces > 0 ? 0.1 : 1

/** Clamp to the minimum sensible quantity and round at the UoM precision. */
export const clampQty = (qty: number, decimalPlaces: number): number => {
  const factor = 10 ** decimalPlaces
  return Math.max(minQtyFor(decimalPlaces), Math.round(qty * factor) / factor)
}
