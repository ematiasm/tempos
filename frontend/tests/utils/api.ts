import type { APIRequestContext } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "../config.ts"

/**
 * Seed data through the backend API (superuser login → token → API calls).
 * Endpoints mirror the generated client (trailing slashes).
 */
export const API_BASE = process.env.VITE_API_URL ?? "http://localhost:8000"

let cachedToken: string | null = null

async function getToken(request: APIRequestContext): Promise<string> {
  if (cachedToken) return cachedToken
  const res = await request.post(`${API_BASE}/api/v1/login/access-token`, {
    form: { username: firstSuperuser, password: firstSuperuserPassword },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
  cachedToken = (await res.json()).access_token as string
  return cachedToken
}

async function _api<T>(
  request: APIRequestContext,
  method: "get" | "post" | "patch" | "delete",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getToken(request)
  const res = await request[method](`${API_BASE}/api/v1${path}`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) {
    throw new Error(
      `${method.toUpperCase()} ${path} failed: ${res.status()} ${await res.text()}`,
    )
  }
  return (await res.json()) as T
}

interface PageResponse<T> {
  data: T[]
  count: number
}

export interface ApiDocumentType {
  id: string
  name: string
  prefix: string
  operation: string
  is_active: boolean
  void_document_type_id: string | null
}

export interface ApiProduct {
  id: string
  name: string
  sku: string | null
  costo_actual: string
  precio_venta: string
  stock_current: string
  stock_minimo: string | null
  stock_maximo: string | null
  is_active: boolean
}

export interface ApiDocument {
  id: string
  numero: string
  document_type: ApiDocumentType
  estado: string
  total: string
  favor_monto?: string
  parent_document_id: string | null
  contraparte_id: string | null
  lines: { id: string; cantidad: string; precio_unit: string }[]
  payments: { payment_method_id: string; monto: string }[]
}

export const api = {
  get: <T>(request: APIRequestContext, path: string) =>
    _api<PageResponse<T>>(request, "get", path),

  getOne: <T>(request: APIRequestContext, path: string) =>
    _api<T>(request, "get", path),

  post: <T>(request: APIRequestContext, path: string, body?: unknown) =>
    _api<T>(request, "post", path, body),

  patch: <T>(request: APIRequestContext, path: string, body?: unknown) =>
    _api<T>(request, "patch", path, body),

  delete: <T>(request: APIRequestContext, path: string) =>
    _api<T>(request, "delete", path),
}

export const getDocumentTypes = (request: APIRequestContext) =>
  api
    .get<ApiDocumentType>(request, "/document-types/?skip=0&limit=100")
    .then((r) => r.data)

export const findDocumentType = (
  types: ApiDocumentType[],
  prefix: string,
): ApiDocumentType => {
  const found = types.find((t) => t.prefix === prefix && t.is_active)
  if (!found) throw new Error(`Document type with prefix ${prefix} not found`)
  return found
}

export const createProduct = async (
  request: APIRequestContext,
  data: {
    name: string
    sku?: string
    uom_id: string
    margen_pct?: number
    costo_actual?: number
    stock_minimo?: number
    stock_maximo?: number
    tax_ids?: string[]
  },
): Promise<ApiProduct> =>
  api.post<ApiProduct>(request, "/products/", {
    name: data.name,
    sku: data.sku ?? null,
    uom_id: data.uom_id,
    margen_pct: data.margen_pct ?? 50,
    costo_actual: data.costo_actual ?? 100,
    stock_minimo: data.stock_minimo ?? null,
    stock_maximo: data.stock_maximo ?? null,
    is_active: true,
    tax_ids: data.tax_ids ?? [],
  })

export const addBarcode = (
  request: APIRequestContext,
  productId: string,
  code: string,
) =>
  api.post(request, `/products/${productId}/barcodes/`, {
    code,
    product_id: productId,
  })

export const readProduct = (
  request: APIRequestContext,
  productId: string,
): Promise<ApiProduct> => api.getOne(request, `/products/${productId}/`)

export const createCustomer = (
  request: APIRequestContext,
  razonSocial: string,
): Promise<{ id: string; razon_social: string }> =>
  api.post(request, "/customers/", { razon_social: razonSocial })

export const createSupplier = (
  request: APIRequestContext,
  razonSocial: string,
): Promise<{ id: string; razon_social: string }> =>
  api.post(request, "/suppliers/", { razon_social: razonSocial })

export const createSupplierProduct = (
  request: APIRequestContext,
  data: { supplier_id: string; product_id: string; costo_actual: number },
) =>
  api.post(request, "/supplier-products/", {
    supplier_id: data.supplier_id,
    product_id: data.product_id,
    costo_actual: data.costo_actual,
    es_referencia: true,
    es_default: true,
  })

export const readSupplierProducts = (
  request: APIRequestContext,
  supplierId: string,
): Promise<
  { product_id: string; costo_actual: string; es_referencia: boolean }[]
> =>
  api
    .get(request, `/supplier-products/?supplier_id=${supplierId}&limit=100`)
    .then((r) => r.data)

/**
 * Adjust stock through an "Ajuste Stock" (AJS) document. `qty` is signed.
 */
export const adjustStock = async (
  request: APIRequestContext,
  productId: string,
  qty: number,
): Promise<ApiDocument> => {
  const types = await getDocumentTypes(request)
  const ajs = findDocumentType(types, "AJS")
  return api.post<ApiDocument>(request, "/documents/", {
    document_type_id: ajs.id,
    contraparte_id: null,
    lines: [{ product_id: productId, cantidad: qty }],
    payments: [],
  })
}

export const createSale = async (
  request: APIRequestContext,
  data: {
    productId: string
    customerId?: string
    qty?: number
    price?: number
    paid?: boolean
  },
): Promise<ApiDocument> => {
  const types = await getDocumentTypes(request)
  const fc = findDocumentType(types, "FC")
  const customerId = data.customerId ?? (await getConsumidorFinalId(request))
  const qty = data.qty ?? 1
  const price = data.price ?? 150
  const paid = data.paid ?? true
  const paymentMethod = paid ? await getPaymentMethods(request) : null
  return api.post<ApiDocument>(request, "/documents/", {
    document_type_id: fc.id,
    contraparte_id: customerId,
    lines: [
      {
        product_id: data.productId,
        cantidad: qty,
        precio_unit: price,
      },
    ],
    payments: paymentMethod
      ? [{ payment_method_id: paymentMethod.id, monto: qty * price }]
      : [],
  })
}

export const getConsumidorFinalId = async (
  request: APIRequestContext,
): Promise<string> => {
  const customers = await api
    .get<{ id: string; razon_social: string }>(
      request,
      "/customers/?skip=0&limit=1000",
    )
    .then((r) => r.data)
  const cf = customers.find((c) => c.razon_social === "Consumidor Final")
  if (!cf) throw new Error("Seeded customer 'Consumidor Final' not found")
  return cf.id
}

export const getPaymentMethods = async (
  request: APIRequestContext,
): Promise<{ id: string; name: string } | null> => {
  const methods = await api
    .get<{ id: string; name: string }>(
      request,
      "/payment-methods/?skip=0&limit=100",
    )
    .then((r) => r.data)
  return methods.find((m) => m.name === "Efectivo") ?? methods[0] ?? null
}

export const createCreditPaymentMethod = async (
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; name: string; marks_paid: boolean }> => {
  const accounts = await api
    .get<{ id: string; name: string }>(
      request,
      "/financial-accounts/?skip=0&limit=100",
    )
    .then((r) => r.data)
  const account = accounts[0]
  if (!account) throw new Error("No financial accounts seeded")
  return api.post<{ id: string; name: string; marks_paid: boolean }>(
    request,
    "/payment-methods/",
    {
      name,
      financial_account_id: account.id,
      marks_paid: false,
      requiere_conciliacion: false,
    },
  )
}

export const readDocuments = (
  request: APIRequestContext,
): Promise<ApiDocument[]> =>
  api
    .get<ApiDocument>(request, "/documents/?skip=0&limit=100")
    .then((r) => r.data)

export const readOutstanding = (
  request: APIRequestContext,
  contraparteType: "customer" | "supplier",
  contraparteId: string,
): Promise<{ document_id: string; numero: string; pendiente: string }[]> =>
  api
    .get<{ document_id: string; numero: string; pendiente: string }>(
      request,
      `/payments/outstanding?contraparte_type=${contraparteType}&contraparte_id=${contraparteId}`,
    )
    .then((r) => r.data)

export const readReceiptAllocations = (
  request: APIRequestContext,
  receiptDocumentId: string,
): Promise<{ document_id: string; numero: string; monto: string }[]> =>
  api.getOne<{ document_id: string; numero: string; monto: string }[]>(
    request,
    `/payments/${receiptDocumentId}/allocations`,
  )

export const createReceipt = async (
  request: APIRequestContext,
  data: {
    contraparteType: "customer" | "supplier"
    contraparteId: string
    methodId: string
    monto: number
  },
): Promise<ApiDocument> => {
  const res = await api.post<{ document: ApiDocument }>(request, "/payments/", {
    contraparte_type: data.contraparteType,
    contraparte_id: data.contraparteId,
    payments: [{ payment_method_id: data.methodId, monto: data.monto }],
  })
  return res.document
}

export const readDocument = (
  request: APIRequestContext,
  documentId: string,
): Promise<ApiDocument> => api.getOne(request, `/documents/${documentId}/`)

export const voidDocument = (request: APIRequestContext, documentId: string) =>
  api.post<ApiDocument>(request, `/documents/${documentId}/void/`, {
    lines: [],
    payments: [],
  })

export const getUoms = (request: APIRequestContext) =>
  api
    .get<{ id: string; name: string; abbreviation: string }>(
      request,
      "/uoms/?skip=0&limit=100",
    )
    .then((r) => r.data)

export const getTaxes = (request: APIRequestContext) =>
  api
    .get<{ id: string; name: string; code: string }>(
      request,
      "/taxes/?skip=0&limit=100",
    )
    .then((r) => r.data)
