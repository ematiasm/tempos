import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import {
  CustomersService,
  DocumentTypesService,
  PaymentMethodsService,
} from "@/client"

const SALE_PREFIXES = ["FA", "FB", "FC", "TCK"]

/**
 * Shared reference data for the sell screen: active customers (plus the
 * seeded Consumidor Final default), payment methods and sale document types.
 * React Query keys: customers / payment-methods / document-types.
 */
export function useReferenceData() {
  const { data: customersData } = useQuery({
    queryFn: () => CustomersService.readCustomers({ skip: 0, limit: 1000 }),
    queryKey: ["customers"],
  })
  const { data: methodsData } = useQuery({
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 1000 }),
    queryKey: ["payment-methods"],
  })
  const { data: typesData } = useQuery({
    queryFn: () =>
      DocumentTypesService.readDocumentTypes({ skip: 0, limit: 100 }),
    queryKey: ["document-types"],
  })
  const customers = useMemo(
    () => (customersData?.data ?? []).filter((c) => c.is_active !== false),
    [customersData],
  )
  const consumidorFinal = useMemo(
    () => customers.find((c) => c.razon_social === "Consumidor Final"),
    [customers],
  )
  const methods = methodsData?.data ?? []
  const saleTypes = useMemo(
    () =>
      (typesData?.data ?? []).filter(
        (t) =>
          t.is_active &&
          t.operation === "venta" &&
          SALE_PREFIXES.includes(t.prefix),
      ),
    [typesData],
  )
  return { customers, consumidorFinal, methods, saleTypes }
}
