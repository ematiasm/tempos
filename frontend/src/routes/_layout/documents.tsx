import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { FileText, Plus, Search, X } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import type { DocumentPublic } from "@/client"
import { DocumentsService, DocumentTypesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import DocumentDetailSheet from "@/components/Documents/DocumentDetailSheet"
import {
  type DocumentTableData,
  getColumns,
} from "@/components/Documents/documentColumns"
import NewDocumentDialog from "@/components/Documents/NewDocumentDialog"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatStatic, useT } from "@/i18n"

interface DocumentFilters {
  typeId: string | null
  userId: string | null
  from: string | null
  to: string | null
}

const NO_FILTERS: DocumentFilters = {
  typeId: null,
  userId: null,
  from: null,
  to: null,
}

const dayStart = (date: string) => new Date(`${date}T00:00:00`).toISOString()
const dayEnd = (date: string) => new Date(`${date}T23:59:59.999`).toISOString()

function getDocumentsQueryOptions(filters: DocumentFilters) {
  return {
    queryFn: () =>
      DocumentsService.readDocuments({
        skip: 0,
        limit: 100,
        documentTypeId: filters.typeId ?? undefined,
        userId: filters.userId ?? undefined,
        fechaDesde: filters.from ? dayStart(filters.from) : undefined,
        fechaHasta: filters.to ? dayEnd(filters.to) : undefined,
      }),
    queryKey: ["documents", filters],
  }
}

export const Route = createFileRoute("/_layout/documents")({
  component: Documents,
  head: () => ({
    meta: [{ title: `${formatStatic("documents.title")} - tempos` }],
  }),
})

function DocumentsContent() {
  const t = useT()
  const [filters, setFilters] = useState<DocumentFilters>(NO_FILTERS)
  const { data: documents } = useSuspenseQuery(
    getDocumentsQueryOptions(filters),
  )
  const { data: typesData } = useQuery({
    queryFn: () =>
      DocumentTypesService.readDocumentTypes({ skip: 0, limit: 100 }),
    queryKey: ["document-types"],
  })
  const { data: creatorsData } = useQuery({
    queryFn: () => DocumentsService.readDocumentCreators(),
    queryKey: ["document-creators"],
  })
  const types = useMemo(
    () => (typesData?.data ?? []).filter((dt) => dt.is_active),
    [typesData],
  )
  const creators = creatorsData ?? []
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<DocumentPublic | null>(null)

  const hasFilters =
    filters.typeId !== null ||
    filters.userId !== null ||
    filters.from !== null ||
    filters.to !== null

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
      <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        {hasFilters ? (
          <>
            <h3 className="text-lg font-semibold">
              {t("documents.noResultsTitle")}
            </h3>
            <p className="text-muted-foreground">
              {t("documents.noResultsHint")}
            </p>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">
              {t("documents.emptyTitle")}
            </h3>
            <p className="text-muted-foreground">{t("documents.emptyHint")}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("documents.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filters.typeId ?? "all"}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, typeId: v === "all" ? null : v }))
          }
        >
          <SelectTrigger className="lg:w-56" data-testid="doc-type-filter">
            <SelectValue placeholder={t("documents.filterType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("documents.allTypes")}</SelectItem>
            {types.map((dt) => (
              <SelectItem key={dt.id} value={dt.id}>
                {dt.name} ({dt.prefix})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.userId ?? "all"}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, userId: v === "all" ? null : v }))
          }
        >
          <SelectTrigger className="lg:w-56" data-testid="doc-user-filter">
            <SelectValue placeholder={t("documents.filterUser")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("documents.allUsers")}</SelectItem>
            {creators.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={t("documents.fromDate")}
            className="lg:w-40"
            value={filters.from ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, from: e.target.value || null }))
            }
          />
          <Input
            type="date"
            aria-label={t("documents.toDate")}
            className="lg:w-40"
            value={filters.to ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, to: e.target.value || null }))
            }
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!hasFilters}
            onClick={() => setFilters(NO_FILTERS)}
            title={t("documents.clearFilters")}
            data-testid="clear-doc-filters"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <DataTable columns={getColumns(t)} data={rows} />
      <DocumentDetailSheet
        document={selected}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  )
}

function Documents() {
  const t = useT()
  const [createOpen, setCreateOpen] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("documents.title")}
          </h1>
          <p className="text-muted-foreground">{t("documents.subtitle")}</p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          data-testid="new-document-button"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("documents.newDocument")}
        </Button>
      </div>
      <Suspense fallback={<PendingUsers />}>
        <DocumentsContent />
      </Suspense>
      <NewDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

export default Documents
