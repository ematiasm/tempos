import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { PaymentMethodPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeletePaymentMethod from "./DeletePaymentMethod"
import EditPaymentMethod from "./EditPaymentMethod"

interface PaymentMethodActionsMenuProps {
  paymentMethod: PaymentMethodPublic
}

export const PaymentMethodActionsMenu = ({
  paymentMethod,
}: PaymentMethodActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditPaymentMethod
          paymentMethod={paymentMethod}
          onSuccess={() => setOpen(false)}
        />
        <DeletePaymentMethod
          paymentMethod={paymentMethod}
          onSuccess={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
