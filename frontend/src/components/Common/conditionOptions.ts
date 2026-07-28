export const TAX_CONDITIONS = [
  { value: "RI", label: "RI" },
  { value: "Monotributo", label: "Monotributo" },
  { value: "Exento", label: "Exento" },
  { value: "Consumidor Final", label: "Consumidor Final" },
] as const

/** Name of the seeded default customer; protected from delete/deactivation. */
export const CONSUMIDOR_FINAL_NAME = "Consumidor Final"
