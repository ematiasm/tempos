import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type Locale, useLocale, useT } from "@/i18n"

const LANGUAGE_LABELS: Record<Locale, string> = {
  es: "Español",
  en: "English",
}

export default function LanguageSettings() {
  const t = useT()
  const { locale, setLocale } = useLocale()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.languageTitle")}</CardTitle>
        <CardDescription>{t("settings.languageHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <SelectTrigger className="w-[220px]" data-testid="language-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="es">{LANGUAGE_LABELS.es}</SelectItem>
            <SelectItem value="en">{LANGUAGE_LABELS.en}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}
