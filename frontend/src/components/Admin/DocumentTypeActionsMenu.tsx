import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { DocumentTypePublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import EditDocumentType from "./EditDocumentType"

interface DocumentTypeActionsMenuProps {
  documentType: DocumentTypePublic
}

export const DocumentTypeActionsMenu = ({
  documentType,
}: DocumentTypeActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditDocumentType
          documentType={documentType}
          onSuccess={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
