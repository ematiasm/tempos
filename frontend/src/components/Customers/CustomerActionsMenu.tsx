import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { CustomerPublic } from "@/client"
import { AccountMovementsDialog } from "@/components/Common/AccountMovementsDialog"
import { CONSUMIDOR_FINAL_NAME } from "@/components/Common/conditionOptions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteCustomer from "./DeleteCustomer"
import EditCustomer from "./EditCustomer"

interface CustomerActionsMenuProps {
  customer: CustomerPublic
}

export const CustomerActionsMenu = ({ customer }: CustomerActionsMenuProps) => {
  const [open, setOpen] = useState(false)
  const isConsumidorFinal = customer.razon_social === CONSUMIDOR_FINAL_NAME

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditCustomer customer={customer} onSuccess={() => setOpen(false)} />
        <AccountMovementsDialog
          counterpart={customer}
          type="customer"
          onClose={() => setOpen(false)}
        />
        {!isConsumidorFinal && (
          <DeleteCustomer
            customer={customer}
            onSuccess={() => setOpen(false)}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
