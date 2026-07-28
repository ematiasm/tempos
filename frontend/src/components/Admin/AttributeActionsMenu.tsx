import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { AttributePublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteAttribute from "./DeleteAttribute"
import EditAttribute from "./EditAttribute"

interface AttributeActionsMenuProps {
  attribute: AttributePublic
}

export const AttributeActionsMenu = ({
  attribute,
}: AttributeActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditAttribute attribute={attribute} onSuccess={() => setOpen(false)} />
        <DeleteAttribute
          attribute={attribute}
          onSuccess={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
