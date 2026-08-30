import { Download, Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"

interface ReportActionsProps {
  /** Whether the tab has loaded rows; the buttons are disabled when empty. */
  hasRows: boolean
  onExportCsv: () => void
  /** Print handler; when absent only the CSV button renders. */
  onPrint?: () => void
}

/** Compact outline icon buttons for a report tab toolbar: CSV + print. */
export function ReportActions({
  hasRows,
  onExportCsv,
  onPrint,
}: ReportActionsProps) {
  const t = useT()
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("reports.exportCsv")}
        title={t("reports.exportCsv")}
        disabled={!hasRows}
        onClick={onExportCsv}
      >
        <Download className="h-4 w-4" />
      </Button>
      {onPrint && (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("common.print")}
          title={t("common.print")}
          disabled={!hasRows}
          onClick={onPrint}
        >
          <Printer className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
