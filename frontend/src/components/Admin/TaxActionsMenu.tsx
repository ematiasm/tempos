import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { TaxPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteTax from "./DeleteTax"
import EditTax from "./EditTax"

interface TaxActionsMenuProps {
  tax: TaxPublic
}

export const TaxActionsMenu = ({ tax }: TaxActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditTax tax={tax} onSuccess={() => setOpen(false)} />
        <DeleteTax tax={tax} onSuccess={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
