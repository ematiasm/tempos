import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { SupplierPublic } from "@/client"
import { AccountMovementsDialog } from "@/components/Common/AccountMovementsDialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteSupplier from "./DeleteSupplier"
import EditSupplier from "./EditSupplier"

interface SupplierActionsMenuProps {
  supplier: SupplierPublic
}

export const SupplierActionsMenu = ({ supplier }: SupplierActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditSupplier supplier={supplier} onSuccess={() => setOpen(false)} />
        <AccountMovementsDialog
          counterpart={supplier}
          type="supplier"
          onClose={() => setOpen(false)}
        />
        <DeleteSupplier supplier={supplier} onSuccess={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
