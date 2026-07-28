import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { CustomersService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import AddCustomer from "@/components/Customers/AddCustomer"
import {
  type CustomerTableData,
  columns as customerColumns,
} from "@/components/Customers/customerColumns"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Input } from "@/components/ui/input"

function getCustomersQueryOptions() {
  return {
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 1000 }),
    queryKey: ["customers"],
  }
}

export const Route = createFileRoute("/_layout/customers")({
  component: Customers,
  head: () => ({
    meta: [
      {
        title: "Customers - FastEmpre",
      },
    ],
  }),
})

function CustomersContent() {
  const { data: customers } = useSuspenseQuery(getCustomersQueryOptions())
  const [search, setSearch] = useState("")

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const data = customers.data as CustomerTableData[]
    if (!q) return data
    return data.filter(
      (c) =>
        c.razon_social.toLowerCase().includes(q) ||
        (c.documento ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    )
  }, [customers.data, search])

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, document or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <DataTable columns={customerColumns} data={rows} />
    </div>
  )
}

function Customers() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            Customers, credit limits and current account balances
          </p>
        </div>
        <AddCustomer />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <CustomersContent />
      </Suspense>
    </div>
  )
}
