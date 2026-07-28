import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban } from "lucide-react"
import { useEffect, useState } from "react"

import type { DocumentPublic } from "@/client"
import { DocumentsService } from "@/client"
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
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface VoidDocumentDialogProps {
  document: DocumentPublic
  open: boolean
  onOpenChange: (open: boolean) => void
  onVoided: () => void
}

const VoidDocumentDialog = ({
  document,
  open,
  onOpenChange,
  onVoided,
}: VoidDocumentDialogProps) => {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  // Fresh detail so pending quantities are exact.
  const { data: fresh } = useQuery({
    queryFn: () => DocumentsService.readDocument({ documentId: document.id }),
    queryKey: ["documents", document.id],
    enabled: open,
  })

  useEffect(() => {
    if (!fresh) return
    const initial: Record<string, string> = {}
    for (const line of fresh.lines ?? []) {
      initial[line.id] = String(line.cantidad_pendiente ?? line.cantidad)
    }
    setQuantities(initial)
  }, [fresh])

  const mutation = useMutation({
    mutationFn: () =>
      DocumentsService.voidDocument({
        documentId: document.id,
        requestBody: {
          lines: (fresh?.lines ?? [])
            .map((line) => ({
              document_line_id: line.id,
              cantidad: parseFloat(quantities[line.id] ?? "0") || 0,
            }))
            .filter((l) => l.cantidad > 0),
          payments: [],
        },
      }),
    onSuccess: (nc) => {
      showSuccessToast(`Credit note ${nc.numero} issued`)
      onOpenChange(false)
      onVoided()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
    },
  })

  const lines = [...(fresh?.lines ?? [])].sort((a, b) => a.orden - b.orden)
  const nothingLeft =
    fresh &&
    (fresh.lines ?? []).every(
      (line) => Number(line.cantidad_pendiente ?? 0) <= 0,
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void {document.numero}
          </DialogTitle>
          <DialogDescription>
            A credit note will be issued with the quantities below (leave a
            field at its remaining quantity to revert it completely; set 0 to
            skip a line). A full void flips the document to voided.
          </DialogDescription>
        </DialogHeader>
        {!fresh && (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {fresh && (
          <ul className="divide-y rounded border py-0">
            {lines.map((line) => {
              const pending = Number(line.cantidad_pendiente ?? line.cantidad)
              return (
                <li
                  key={line.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="flex-1 text-sm">
                    <span className="text-muted-foreground">
                      {Number(line.cantidad)} ×{" "}
                      {Number(line.precio_unit).toFixed(2)}
                    </span>
                    <span className="ml-2 text-xs">(left: {pending})</span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={pending}
                    step="0.001"
                    className="w-28"
                    value={quantities[line.id] ?? ""}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.id]: e.target.value,
                      }))
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
        {nothingLeft && (
          <p className="text-sm text-muted-foreground">
            Nothing left to void on this document.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              const all: Record<string, string> = {}
              for (const line of lines) {
                all[line.id] = String(line.cantidad_pendiente ?? line.cantidad)
              }
              setQuantities(all)
            }}
          >
            Void all remaining
          </Button>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            type="button"
            loading={mutation.isPending}
            disabled={!fresh || !!nothingLeft}
            onClick={() => mutation.mutate()}
          >
            Issue credit note
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default VoidDocumentDialog
