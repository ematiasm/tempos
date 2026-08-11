import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useT } from "@/i18n"

export interface DocumentRef {
  id: string
  numero: string
  fecha: string
  total: string
  estado: string
  type_name: string
}

/** Extract the ``documents`` list from a 409 *_in_use error, or null. */
export function extractBlockedDocuments(err: unknown): DocumentRef[] | null {
  const detail = (err as { body?: { detail?: unknown } }).body?.detail
  if (detail && typeof detail === "object" && "documents" in detail) {
    const docs = (detail as { documents?: DocumentRef[] }).documents
    return docs && docs.length > 0 ? docs : null
  }
  return null
}

interface BlockedByDocumentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  hint: string
  documents: DocumentRef[]
}

const BlockedByDocumentsDialog = ({
  open,
  onOpenChange,
  title,
  hint,
  documents,
}: BlockedByDocumentsDialogProps) => {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.documentNumber")}</TableHead>
                <TableHead>{t("common.documentDate")}</TableHead>
                <TableHead>{t("common.documentType")}</TableHead>
                <TableHead className="text-right">
                  {t("common.documentTotal")}
                </TableHead>
                <TableHead>{t("common.documentStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-mono text-xs">
                    {doc.numero}
                  </TableCell>
                  <TableCell>
                    {new Date(doc.fecha).toLocaleDateString("es-AR")}
                  </TableCell>
                  <TableCell>{doc.type_name}</TableCell>
                  <TableCell className="text-right">
                    ${Number(doc.total).toLocaleString("es-AR")}
                  </TableCell>
                  <TableCell className="capitalize">{doc.estado}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline">{t("common.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BlockedByDocumentsDialog
