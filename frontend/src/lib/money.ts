/**
 * Money rounding, in one place.
 *
 * The backend rounds `Decimal` amounts with `ROUND_HALF_UP` at 0.01, and a float cannot
 * reproduce that on its own: `1.005` is really `1.00499999999999989…`, and `8.575` is
 * really `8.57499999999999928…`. Multiplying by 100 and rounding therefore lands a cent
 * low, and adding `Number.EPSILON` only fixes the cases where the value sits close to 1 —
 * at `8.575` the float's own precision is larger than epsilon, so the addition is lost.
 *
 * `toFixed(6)` recovers the decimal the amount was meant to be — six digits, far more than
 * money carries — and the third digit then decides: five or more rounds up, away from zero,
 * which is what the backend does. Rounding to three digits first would be a double rounding:
 * `2.3449` is `2.345` at three digits and would round up, when the third digit is a 4.
 */

/** Round a money amount to cents, half up, matching the backend's `ROUND_HALF_UP`. */
export const round2 = (value: number): number => {
  if (!Number.isFinite(value)) return value
  const fixed = Math.abs(value).toFixed(6)
  // Beyond 1e21 the number has no decimal form (`toFixed` returns "1e+21"), which is far
  // outside anything this system handles, so the value is left as it is.
  if (!fixed.includes(".")) return value
  const [whole, decimals] = fixed.split(".")
  const digits = `${decimals}000`.slice(0, 3)
  const cents = Number(`${whole}.${digits.slice(0, 2)}`)
  const rounded = digits[2] >= "5" ? cents + 0.01 : cents
  return Number((value < 0 ? -rounded : rounded).toFixed(2))
}
