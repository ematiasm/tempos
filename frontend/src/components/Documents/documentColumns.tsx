import type { ColumnDef } from "@tanstack/react-table"
import { Eye } from "lucide-react"

import type { DocumentPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { useT } from "@/i18n"
import { cn } from "@/lib/utils"

export type DocumentTableData = DocumentPublic & {
  onView: (document: DocumentPublic) => void
}

const money = (value: string | number) => `$${Number(value).toFixed(2)}`

export function getColumns(
  t: ReturnType<typeof useT>,
): ColumnDef<DocumentTableData>[] {
  return [
    {
      accessorKey: "numero",
      header: t("documents.number"),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => row.original.onView(row.original)}
          className="font-mono text-sm hover:underline cursor-pointer"
        >
          {row.original.numero}
        </button>
      ),
    },
    {
      accessorKey: "document_type",
      header: t("documents.type"),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.document_type.name}
        </Badge>
      ),
    },
    {
      accessorKey: "fecha",
      header: t("documents.date"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {new Date(row.original.fecha).toLocaleDateString("es-AR")}
        </span>
      ),
    },
    {
      accessorKey: "contraparte_name",
      header: t("documents.counterpart"),
      cell: ({ row }) => (
        <span className="text-sm">{row.original.contraparte_name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "total",
      header: () => <div className="text-right">{t("documents.total")}</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-sm">
          {money(row.original.total)}
        </div>
      ),
    },
    {
      accessorKey: "estado",
      header: t("documents.status"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              row.original.estado === "active" ? "bg-green-500" : "bg-gray-400",
            )}
          />
          <span className="capitalize text-sm">{row.original.estado}</span>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => row.original.onView(row.original)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]
}
