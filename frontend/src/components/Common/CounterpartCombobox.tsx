import { Check, ChevronsUpDown } from "lucide-react"
import { type RefObject, useImperativeHandle, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useLocale, useT } from "@/i18n"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface CounterpartOption {
  id: string
  razon_social: string
  documento: string | null
  saldo: string | number
}

/** Imperative handle for screens with keyboard shortcuts (e.g. Alt+C). */
export interface CounterpartComboboxControls {
  /** Opens the popover; Radix then focuses the search input. */
  openAndFocus: () => void
}

interface CounterpartComboboxProps {
  items: CounterpartOption[]
  /** Currently selected counterpart id, or null while nothing is selected. */
  value: string | null
  /** Picking is final: this combobox offers no "none" clear option. */
  onChange: (id: string) => void
  placeholder: string
  triggerTestId?: string
  /** Imperative handle so screens can open + focus the picker via a shortcut. */
  controlsRef?: RefObject<CounterpartComboboxControls | null>
}

/**
 * Searchable counterpart picker (customers/suppliers). Matches "contains",
 * case-insensitive, against `razon_social` OR `documento`; every row shows
 * the name, document and formatted saldo (including 0). Keyboard navigation
 * comes from cmdk. Filtering is done here (shouldFilter=false) so the match
 * semantics stay deterministic.
 */
export function CounterpartCombobox({
  items,
  value,
  onChange,
  placeholder,
  triggerTestId,
  controlsRef,
}: CounterpartComboboxProps) {
  const t = useT()
  const { numberFormat } = useLocale()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  // The search input only exists while the popover is mounted, so shortcuts
  // open the popover instead of focusing the input directly.
  useImperativeHandle(
    controlsRef,
    () => ({
      openAndFocus: () => setOpen(true),
    }),
    [],
  )

  const selected = items.find((item) => item.id === value) ?? null

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return items
    return items.filter(
      (item) =>
        item.razon_social.toLowerCase().includes(term) ||
        (item.documento ?? "").toLowerCase().includes(term),
    )
  }, [items, search])

  const close = () => {
    setOpen(false)
    setSearch("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else setOpen(true)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={triggerTestId}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? (
              selected.razon_social
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            data-testid="counterpart-combobox-search"
            placeholder={t("common.search")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    onChange(item.id)
                    close()
                  }}
                >
                  <Check
                    className={cn(
                      item.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="truncate">{item.razon_social}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {item.documento && (
                        <span className="font-mono">{item.documento}</span>
                      )}
                      <span>{money(Number(item.saldo), numberFormat)}</span>
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
