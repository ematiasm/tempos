import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { FinancialAccountPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteFinancialAccount from "./DeleteFinancialAccount"
import EditFinancialAccount from "./EditFinancialAccount"

interface FinancialAccountActionsMenuProps {
  account: FinancialAccountPublic
}

export const FinancialAccountActionsMenu = ({
  account,
}: FinancialAccountActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditFinancialAccount
          account={account}
          onSuccess={() => setOpen(false)}
        />
        <DeleteFinancialAccount
          account={account}
          onSuccess={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
