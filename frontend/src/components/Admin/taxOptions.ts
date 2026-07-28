import type { TaxAppliesTo, TaxType } from "@/client"

export const TAX_TYPES: { value: TaxType; label: string }[] = [
  { value: "IVA", label: "IVA" },
  { value: "IIBB", label: "IIBB (Ingresos Brutos)" },
  { value: "PercGan", label: "PercGan (Percepción Ganancias)" },
  { value: "Interno", label: "Interno" },
  { value: "Otro", label: "Otro" },
]

export const TAX_APPLIES_TO: { value: TaxAppliesTo; label: string }[] = [
  { value: "linea", label: "Per line" },
  { value: "documento", label: "Per document" },
]
