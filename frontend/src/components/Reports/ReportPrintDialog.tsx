import { Printer } from "lucide-react"
import { useBusinessSettings } from "@/components/Sell/useBusinessSettings"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"

export interface ReportPrintSection {
  /** Optional section heading (e.g. the VAT report's two tax groups). */
  title?: string
  headers: string[]
  /** Pre-formatted display cells, one array per table row. */
  rows: string[][]
  /** Label/value rows rendered under the table. */
  totals?: { label: string; value: string }[]
}

interface ReportPrintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** "dd/mm/yyyy — dd/mm/yyyy" or any other filter summary. */
  period?: string
  sections: ReportPrintSection[]
}

/**
 * Printable preview for a report tab. Mirrors the voucher print mechanism
 * (PrintVoucherDialog): fixed overlay with a `no-print` toolbar and a
 * `voucher-scroll` body; the printable content carries `id="report-print"`,
 * which the global print CSS isolates (same strategy as `#voucher-print`).
 */
export function ReportPrintDialog({
  open,
  onOpenChange,
  title,
  period,
  sections,
}: ReportPrintDialogProps) {
  const t = useT()
  const { settings } = useBusinessSettings()
  if (!open) return null

  return (
    <div className="voucher-overlay fixed inset-0 z-50 flex flex-col bg-background">
      <style>{`@media print { @page { size: A4; margin: ${settings?.print_margin_report_mm ?? 10}mm; } }`}</style>
      <div className="no-print flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-lg font-semibold">{t("reports.printPreview")}</h2>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
          <Button type="button" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t("common.print")}
          </Button>
        </div>
      </div>
      <div className="voucher-scroll flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-8">
        <div
          id="report-print"
          className="mx-auto max-w-[800px] bg-white p-8 text-black"
        >
          <div className="border-b border-black pb-4 text-center">
            <h1 className="text-xl font-bold uppercase tracking-wide">
              {settings?.business_name ?? title}
            </h1>
            <p className="text-base font-semibold">{title}</p>
            {period && (
              <p className="text-sm text-black/60">
                {t("reports.period")}: {period}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-6 py-4">
            {sections.map((section, sectionIndex) => (
              <div key={sectionIndex}>
                {section.title && (
                  <h3 className="mb-1 border-b border-black pb-1 text-sm font-semibold uppercase">
                    {section.title}
                  </h3>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black text-left">
                      {section.headers.map((header) => (
                        <th key={header} className="py-2 pr-2 font-semibold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, rowIndex) => (
                      <tr
                        key={rowIndex}
                        className="border-b border-dotted border-black/40"
                      >
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="py-2 pr-2">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {section.totals && section.totals.length > 0 && (
                  <div className="voucher-totals ml-auto mt-2 flex w-64 flex-col gap-1 text-sm">
                    {section.totals.map((total) => (
                      <div
                        key={total.label}
                        className="flex justify-between gap-4"
                      >
                        <span>{total.label}</span>
                        <span>{total.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReportPrintDialog
