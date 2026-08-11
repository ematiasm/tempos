import type { TaxAppliesTo, TaxType } from "@/client"
import type { useT } from "@/i18n"

export function getTaxTypes(
  t: ReturnType<typeof useT>,
): { value: TaxType; label: string }[] {
  return [
    { value: "IVA", label: t("admin.taxes.typeIva") },
    { value: "IIBB", label: t("admin.taxes.typeIibb") },
    { value: "PercGan", label: t("admin.taxes.typePercGan") },
    { value: "Interno", label: t("admin.taxes.typeInterno") },
    { value: "Otro", label: t("admin.taxes.typeOtro") },
  ]
}

export function getTaxAppliesTo(
  t: ReturnType<typeof useT>,
): { value: TaxAppliesTo; label: string }[] {
  return [
    { value: "linea", label: t("admin.taxes.appliesLine") },
    { value: "documento", label: t("admin.taxes.appliesDocument") },
  ]
}
