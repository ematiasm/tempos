import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { HandCoins, Search } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import type { DocumentPublic } from "@/client"
import { DocumentsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { ReceiptAllocationsDialog } from "@/components/Payments/ReceiptAllocationsDialog"
import { ReceiptDialog } from "@/components/Payments/ReceiptDialog"
import PendingUsers from "@/components/Pending/PendingUsers"
import { money } from "@/components/Reports/reportFormat"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatStatic, useT } from "@/i18n"

const RECEIPT_PREFIXES = ["RC", "RP"]

function getDocumentsQueryOptions() {
  return {
    queryFn: () => DocumentsService.readDocuments({ skip: 0, limit: 100 }),
    queryKey: ["documents"],
  }
}

export const Route = createFileRoute("/_layout/payments")({
  component: Payments,
  head: () => ({
    meta: [{ title: `${formatStatic("payments.title")} - tempos` }],
  }),
})

interface ReceiptRow {
  id: string
  numero: string
  fecha: string
  prefix: string
  contraparte: string | null
  total: number
  document: DocumentPublic
}

function PaymentsContent() {
  const t = useT()
  const { data: documents } = useSuspenseQuery(getDocumentsQueryOptions())
  const [search, setSearch] = useState("")
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [allocations, setAllocations] = useState<{
    id: string
    numero: string
  } | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const receipts = (documents.data ?? []).filter(
      (d) =>
        RECEIPT_PREFIXES.includes(d.document_type.prefix) &&
        d.estado === "active",
    )
    const filtered = receipts.filter(
      (d) =>
        !q ||
        d.numero.toLowerCase().includes(q) ||
        (d.contraparte_name ?? "").toLowerCase().includes(q),
    )
    return filtered.map(
      (d): ReceiptRow => ({
        id: d.id,
        numero: d.numero,
        fecha: d.fecha ?? "",
        prefix: d.document_type.prefix,
        contraparte: d.contraparte_name ?? null,
        total: Number(d.total),
        document: d,
      }),
    )
  }, [documents.data, search])

  const openAllocations = (receipt: DocumentPublic) =>
    setAllocations({ id: receipt.id, numero: receipt.numero })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("payments.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setReceiptOpen(true)}>
          <HandCoins className="mr-2 h-4 w-4" />
          {t("payments.newReceipt")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-12 border rounded-lg">
          <div className="rounded-full bg-muted p-4 mb-4">
            <HandCoins className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t("payments.emptyTitle")}</h3>
          <p className="text-muted-foreground">{t("payments.emptyHint")}</p>
        </div>
      ) : (
        <DataTable
          columns={[
            {
              accessorKey: "numero",
              header: t("currentAccount.document"),
              cell: ({ row }) => (
                <span className="font-mono text-xs">{row.original.numero}</span>
              ),
            },
            {
              accessorKey: "fecha",
              header: t("currentAccount.date"),
              cell: ({ row }) => (row.original.fecha || "").slice(0, 10),
            },
            {
              accessorKey: "prefix",
              header: t("payments.type"),
              cell: ({ row }) => (
                <span className="font-mono text-xs">{row.original.prefix}</span>
              ),
            },
            {
              accessorKey: "contraparte",
              header: t("payments.counterpartColumn"),
              cell: ({ row }) => row.original.contraparte ?? "—",
            },
            {
              accessorKey: "total",
              header: t("payments.totalColumn"),
              cell: ({ row }) => (
                <span className="font-mono">{money(row.original.total)}</span>
              ),
            },
            {
              id: "allocations",
              header: t("payments.allocations"),
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openAllocations(row.original.document)}
                >
                  {t("payments.viewAllocations")}
                </Button>
              ),
            },
          ]}
          data={rows}
        />
      )}

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        onCreated={() => {}}
      />
      <ReceiptAllocationsDialog
        receiptId={allocations?.id ?? null}
        numero={allocations?.numero ?? ""}
        open={allocations !== null}
        onOpenChange={(o) => !o && setAllocations(null)}
      />
    </div>
  )
}

function Payments() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("payments.title")}
        </h1>
        <p className="text-muted-foreground">{t("payments.subtitle")}</p>
      </div>
      <Suspense fallback={<PendingUsers />}>
        <PaymentsContent />
      </Suspense>
    </div>
  )
}
