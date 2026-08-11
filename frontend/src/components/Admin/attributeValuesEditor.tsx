import { Plus, X } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n"

interface AttributeValuesEditorProps {
  values: string[]
  onChange: (values: string[]) => void
}

/**
 * Small inline editor for an attribute's value list: input + Enter adds a
 * value, badge X removes it. Duplicates (case-insensitive) are ignored.
 */
const AttributeValuesEditor = ({
  values,
  onChange,
}: AttributeValuesEditorProps) => {
  const t = useT()
  const [draft, setDraft] = useState("")

  const addValue = () => {
    const value = draft.trim()
    if (!value) return
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setDraft("")
      return
    }
    onChange([...values, value])
    setDraft("")
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          placeholder={t("admin.attributes.valuesPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addValue()
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={addValue}
          disabled={!draft.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {values.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.attributes.noValuesYet")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="gap-1">
              {value}
              <button
                type="button"
                aria-label={t("admin.attributes.removeValue", { value })}
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="cursor-pointer rounded-full hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export default AttributeValuesEditor
