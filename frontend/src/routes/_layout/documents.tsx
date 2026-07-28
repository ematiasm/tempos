import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { FileText, Search } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import type { DocumentPublic } from "@/client"
import { DocumentsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import DocumentDetailDialog from "@/components/Documents/DocumentDetailDialog"
import {
  type DocumentTableData,
  getColumns,
} from "@/components/Documents/documentColumns"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Input } from "@/components/ui/input"

function getDocumentsQueryOptions() {
  return {
    queryFn: () => DocumentsService.readDocuments({ skip: 0, limit: 100 }),
    queryKey: ["documents"],
  }
}

export const Route = createFileRoute("/_layout/documents")({
  component: Documents,
  head: () => ({
    meta: [
      {
        title: "Documents - FastEmpre",
      },
    ],
  }),
})

function DocumentsContent() {
  const { data: documents } = useSuspenseQuery(getDocumentsQueryOptions())
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<DocumentPublic | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = (documents.data ?? []).filter(
      (d) =>
        !q ||
        d.numero.toLowerCase().includes(q) ||
        (d.contraparte_name ?? "").toLowerCase().includes(q) ||
        d.document_type.name.toLowerCase().includes(q),
    )
    return filtered.map(
      (d): DocumentTableData => ({ ...d, onView: (doc) => setSelected(doc) }),
    )
  }, [documents.data, search])

  if ((documents.data ?? []).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12 border rounded-lg">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No documents yet</h3>
        <p className="text-muted-foreground">
          Sales, purchases and quotes will appear here
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by number, type or counterpart..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <DataTable columns={getColumns} data={rows} />
      <DocumentDetailDialog
        document={selected}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  )
}

function Documents() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground">
          All sales, purchases, quotes and adjustments (read-only)
        </p>
      </div>
      <Suspense fallback={<PendingUsers />}>
        <DocumentsContent />
      </Suspense>
    </div>
  )
}
