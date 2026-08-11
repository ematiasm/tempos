import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { Suspense } from "react"

import {
  AttributesService,
  CategoriesService,
  type CategoryPublic,
  DocumentTypesService,
  type FinancialAccountPublic,
  FinancialAccountsService,
  type PaymentMethodPublic,
  PaymentMethodsService,
  type RolePublic,
  RolesService,
  TaxesService,
  UomsService,
  type UserPublic,
  UsersService,
} from "@/client"
import AddAttribute from "@/components/Admin/AddAttribute"
import AddCategory from "@/components/Admin/AddCategory"
import AddFinancialAccount from "@/components/Admin/AddFinancialAccount"
import AddPaymentMethod from "@/components/Admin/AddPaymentMethod"
import AddRole from "@/components/Admin/AddRole"
import AddTax from "@/components/Admin/AddTax"
import AddUoM from "@/components/Admin/AddUoM"
import AddUser from "@/components/Admin/AddUser"
import {
  type AttributeTableData,
  getColumns as getAttributeColumns,
} from "@/components/Admin/attributeColumns"
import BackupsTab from "@/components/Admin/Backup/BackupsTab"
import {
  buildCategoryRows,
  type CategoryTableData,
  getColumns as getCategoryColumns,
} from "@/components/Admin/categoryColumns"
import {
  getColumns as getUserColumns,
  type UserTableData,
} from "@/components/Admin/columns"
import {
  type DocumentTypeTableData,
  getColumns as getDocumentTypeColumns,
} from "@/components/Admin/documentTypeColumns"
import {
  type FinancialAccountTableData,
  getColumns as getFinancialAccountColumns,
} from "@/components/Admin/financialAccountColumns"
import GeneralSettings from "@/components/Admin/GeneralSettings"
import {
  getColumns as getPaymentMethodColumns,
  type PaymentMethodTableData,
} from "@/components/Admin/paymentMethodColumns"
import {
  getRoleColumns,
  type RoleTableData,
} from "@/components/Admin/roleColumns"
import {
  getColumns as getTaxColumns,
  type TaxTableData,
} from "@/components/Admin/taxColumns"
import {
  getColumns as getUoMColumns,
  type UoMTableData,
} from "@/components/Admin/uomColumns"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import { formatStatic, useT } from "@/i18n"

function getUsersQueryOptions() {
  return {
    queryFn: () => UsersService.readUsers({ skip: 0, limit: 100 }),
    queryKey: ["users"],
  }
}

function getRolesQueryOptions() {
  return {
    queryFn: () => RolesService.readRoles({ skip: 0, limit: 100 }),
    queryKey: ["roles"],
  }
}

function getCategoriesQueryOptions() {
  return {
    queryFn: () => CategoriesService.readCategories({ skip: 0, limit: 100 }),
    queryKey: ["categories"],
  }
}

function getUomsQueryOptions() {
  return {
    queryFn: () => UomsService.readUoms({ skip: 0, limit: 100 }),
    queryKey: ["uoms"],
  }
}

function getTaxesQueryOptions() {
  return {
    queryFn: () => TaxesService.readTaxes({ skip: 0, limit: 100 }),
    queryKey: ["taxes"],
  }
}

function getAttributesQueryOptions() {
  return {
    queryFn: () => AttributesService.readAttributes({ skip: 0, limit: 100 }),
    queryKey: ["attributes"],
  }
}

function getDocumentTypesQueryOptions() {
  return {
    queryFn: () =>
      DocumentTypesService.readDocumentTypes({ skip: 0, limit: 100 }),
    queryKey: ["document-types"],
  }
}

function getFinancialAccountsQueryOptions() {
  return {
    queryFn: () =>
      FinancialAccountsService.readFinancialAccounts({ skip: 0, limit: 100 }),
    queryKey: ["financial-accounts"],
  }
}

function getPaymentMethodsQueryOptions() {
  return {
    queryFn: () =>
      PaymentMethodsService.readPaymentMethods({ skip: 0, limit: 100 }),
    queryKey: ["payment-methods"],
  }
}

export const Route = createFileRoute("/_layout/admin")({
  component: Admin,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: `${formatStatic("admin.title")} - tempos`,
      },
    ],
  }),
})

function UsersTableContent() {
  const t = useT()
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={getUserColumns(t)} data={tableData} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

function RolesTableContent() {
  const t = useT()
  const { data: roles } = useSuspenseQuery(getRolesQueryOptions())

  const tableData: RoleTableData[] = roles.data.map((role: RolePublic) => ({
    ...role,
  }))

  return <DataTable columns={getRoleColumns(t)} data={tableData} />
}

function RolesTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <RolesTableContent />
    </Suspense>
  )
}

function UsersAndRolesTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">{t("admin.users.title")}</TabsTrigger>
          <TabsTrigger value="roles">{t("admin.roles.title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {t("admin.users.title")}
                </h2>
                <p className="text-muted-foreground">
                  {t("admin.users.subtitle")}
                </p>
              </div>
              <AddUser />
            </div>
            <UsersTable />
          </div>
        </TabsContent>
        <TabsContent value="roles">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {t("admin.roles.title")}
                </h2>
                <p className="text-muted-foreground">
                  {t("admin.roles.subtitle")}
                </p>
              </div>
              <AddRole />
            </div>
            <RolesTable />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CategoriesTabContent() {
  const t = useT()
  const { data: categories } = useSuspenseQuery(getCategoriesQueryOptions())

  if (categories.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">
          {t("admin.categories.emptyTitle")}
        </h3>
        <p className="text-muted-foreground">
          {t("admin.categories.emptyHint")}
        </p>
      </div>
    )
  }

  const rows: (CategoryTableData & { depth: number })[] = buildCategoryRows(
    categories.data as CategoryPublic[],
  )
  return <DataTable columns={getCategoryColumns(t)} data={rows} />
}

function CategoriesTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.categories.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.categories.subtitle")}
          </p>
        </div>
        <AddCategory />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <CategoriesTabContent />
      </Suspense>
    </div>
  )
}

function UoMsTabContent() {
  const t = useT()
  const { data: uoms } = useSuspenseQuery(getUomsQueryOptions())

  if (uoms.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t("admin.units.emptyTitle")}</h3>
        <p className="text-muted-foreground">{t("admin.units.emptyHint")}</p>
      </div>
    )
  }

  return (
    <DataTable columns={getUoMColumns(t)} data={uoms.data as UoMTableData[]} />
  )
}

function UoMsTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.units.title")}
          </h2>
          <p className="text-muted-foreground">{t("admin.units.subtitle")}</p>
        </div>
        <AddUoM />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <UoMsTabContent />
      </Suspense>
    </div>
  )
}

function TaxesTabContent() {
  const t = useT()
  const { data: taxes } = useSuspenseQuery(getTaxesQueryOptions())

  if (taxes.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t("admin.taxes.emptyTitle")}</h3>
        <p className="text-muted-foreground">{t("admin.taxes.emptyHint")}</p>
      </div>
    )
  }

  return (
    <DataTable columns={getTaxColumns(t)} data={taxes.data as TaxTableData[]} />
  )
}

function TaxesTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.taxes.title")}
          </h2>
          <p className="text-muted-foreground">{t("admin.taxes.subtitle")}</p>
        </div>
        <AddTax />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <TaxesTabContent />
      </Suspense>
    </div>
  )
}

function AttributesTabContent() {
  const t = useT()
  const { data: attributes } = useSuspenseQuery(getAttributesQueryOptions())

  if (attributes.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">
          {t("admin.attributes.emptyTitle")}
        </h3>
        <p className="text-muted-foreground">
          {t("admin.attributes.emptyHint")}
        </p>
      </div>
    )
  }

  return (
    <DataTable
      columns={getAttributeColumns(t)}
      data={attributes.data as AttributeTableData[]}
    />
  )
}

function AttributesTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.attributes.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.attributes.subtitle")}
          </p>
        </div>
        <AddAttribute />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <AttributesTabContent />
      </Suspense>
    </div>
  )
}

function DocumentTypesTabContent() {
  const t = useT()
  const { data: documentTypes } = useSuspenseQuery(
    getDocumentTypesQueryOptions(),
  )

  return (
    <DataTable
      columns={getDocumentTypeColumns(t)}
      data={documentTypes.data as DocumentTypeTableData[]}
    />
  )
}

function DocumentTypesTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          {t("admin.documentTypes.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("admin.documentTypes.subtitle")}
        </p>
      </div>
      <Suspense fallback={<PendingUsers />}>
        <DocumentTypesTabContent />
      </Suspense>
    </div>
  )
}

function FinancialAccountsTabContent() {
  const t = useT()
  const { data: accounts } = useSuspenseQuery(
    getFinancialAccountsQueryOptions(),
  )

  return (
    <DataTable
      columns={getFinancialAccountColumns(t)}
      data={accounts.data as FinancialAccountTableData[]}
    />
  )
}

function AccountsTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.finance.accountsTitle")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.finance.accountsSubtitle")}
          </p>
        </div>
        <AddFinancialAccount />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <FinancialAccountsTabContent />
      </Suspense>
    </div>
  )
}

function PaymentMethodsTabContent() {
  const t = useT()
  const { data: accounts } = useSuspenseQuery(
    getFinancialAccountsQueryOptions(),
  )
  const { data: paymentMethods } = useSuspenseQuery(
    getPaymentMethodsQueryOptions(),
  )
  const accountNames = new Map(
    accounts.data.map((a: FinancialAccountPublic) => [a.id, a.name]),
  )

  const rows: PaymentMethodTableData[] = paymentMethods.data.map(
    (pm: PaymentMethodPublic) => ({
      ...pm,
      account_name: accountNames.get(pm.financial_account_id),
    }),
  )

  return <DataTable columns={getPaymentMethodColumns(t)} data={rows} />
}

function PaymentMethodsTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.finance.paymentMethodsTitle")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.finance.paymentMethodsSubtitle")}
          </p>
        </div>
        <AddPaymentMethod />
      </div>
      <Suspense fallback={<PendingUsers />}>
        <PaymentMethodsTabContent />
      </Suspense>
    </div>
  )
}

function FinanceTab() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">
            {t("admin.finance.tabAccounts")}
          </TabsTrigger>
          <TabsTrigger value="payment-methods">
            {t("admin.finance.tabPaymentMethods")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="accounts">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="payment-methods">
          <PaymentMethodsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Admin() {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("admin.title")}
        </h1>
        <p className="text-muted-foreground">{t("admin.subtitle")}</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="general">{t("admin.tabGeneral")}</TabsTrigger>
          <TabsTrigger value="users-roles">
            {t("admin.tabUsersRoles")}
          </TabsTrigger>
          <TabsTrigger value="categories">
            {t("admin.tabCategories")}
          </TabsTrigger>
          <TabsTrigger value="units">{t("admin.tabUnits")}</TabsTrigger>
          <TabsTrigger value="taxes">{t("admin.tabTaxes")}</TabsTrigger>
          <TabsTrigger value="attributes">
            {t("admin.tabAttributes")}
          </TabsTrigger>
          <TabsTrigger value="document-types">
            {t("admin.tabDocumentTypes")}
          </TabsTrigger>
          <TabsTrigger value="finance">{t("admin.tabFinance")}</TabsTrigger>
          <TabsTrigger value="backups">{t("admin.tabBackups")}</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="users-roles">
          <UsersAndRolesTab />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="units">
          <UoMsTab />
        </TabsContent>
        <TabsContent value="taxes">
          <TaxesTab />
        </TabsContent>
        <TabsContent value="attributes">
          <AttributesTab />
        </TabsContent>
        <TabsContent value="document-types">
          <DocumentTypesTab />
        </TabsContent>
        <TabsContent value="finance">
          <FinanceTab />
        </TabsContent>
        <TabsContent value="backups">
          <BackupsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
