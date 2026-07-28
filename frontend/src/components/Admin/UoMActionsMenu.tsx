import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { UoMPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteUoM from "./DeleteUoM"
import EditUoM from "./EditUoM"

interface UoMActionsMenuProps {
  uom: UoMPublic
}

export const UoMActionsMenu = ({ uom }: UoMActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditUoM uom={uom} onSuccess={() => setOpen(false)} />
        <DeleteUoM uom={uom} onSuccess={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
