import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { Suspense } from "react"

import {
  AttributesService,
  CategoriesService,
  type CategoryPublic,
  DocumentTypesService,
  type RolePublic,
  RolesService,
  TaxesService,
  UomsService,
  type UserPublic,
  UsersService,
} from "@/client"
import AddAttribute from "@/components/Admin/AddAttribute"
import AddCategory from "@/components/Admin/AddCategory"
import AddRole from "@/components/Admin/AddRole"
import AddTax from "@/components/Admin/AddTax"
import AddUoM from "@/components/Admin/AddUoM"
import AddUser from "@/components/Admin/AddUser"
import {
  type AttributeTableData,
  columns as attributeColumns,
} from "@/components/Admin/attributeColumns"
import {
  buildCategoryRows,
  type CategoryTableData,
  columns as categoryColumns,
} from "@/components/Admin/categoryColumns"
import {
  type UserTableData,
  columns as userColumns,
} from "@/components/Admin/columns"
import {
  type DocumentTypeTableData,
  columns as documentTypeColumns,
} from "@/components/Admin/documentTypeColumns"
import GeneralSettings from "@/components/Admin/GeneralSettings"
import { type RoleTableData, roleColumns } from "@/components/Admin/roleColumns"
import {
  type TaxTableData,
  columns as taxColumns,
} from "@/components/Admin/taxColumns"
import {
  type UoMTableData,
  columns as uomColumns,
} from "@/components/Admin/uomColumns"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

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
        title: "Admin - FastEmpre",
      },
    ],
  }),
})

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={userColumns} data={tableData} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

function RolesTableContent() {
  const { data: roles } = useSuspenseQuery(getRolesQueryOptions())

  const tableData: RoleTableData[] = roles.data.map((role: RolePublic) => ({
    ...role,
  }))

  return <DataTable columns={roleColumns} data={tableData} />
}

function RolesTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <RolesTableContent />
    </Suspense>
  )
}

function UsersAndRolesTab() {
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Users</h2>
                <p className="text-muted-foreground">
                  Manage user accounts and role assignments
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
                <h2 className="text-xl font-bold tracking-tight">Roles</h2>
                <p className="text-muted-foreground">
                  Manage roles and their permissions
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
  const { data: categories } = useSuspenseQuery(getCategoriesQueryOptions())

  if (categories.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No categories yet</h3>
        <p className="text-muted-foreground">
          Add a category to organize your products
        </p>
      </div>
    )
  }

  const rows: (CategoryTableData & { depth: number })[] = buildCategoryRows(
    categories.data as CategoryPublic[],
  )
  return <DataTable columns={categoryColumns} data={rows} />
}

function CategoriesTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Categories</h2>
          <p className="text-muted-foreground">
            Hierarchical product categories
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
  const { data: uoms } = useSuspenseQuery(getUomsQueryOptions())

  if (uoms.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No units yet</h3>
        <p className="text-muted-foreground">
          Add at least one unit of measure (e.g. Unit, Kilogram)
        </p>
      </div>
    )
  }

  return <DataTable columns={uomColumns} data={uoms.data as UoMTableData[]} />
}

function UoMsTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Units of Measure</h2>
          <p className="text-muted-foreground">
            Units used to stock and sell products
          </p>
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
  const { data: taxes } = useSuspenseQuery(getTaxesQueryOptions())

  if (taxes.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No taxes yet</h3>
        <p className="text-muted-foreground">
          Add taxes (VAT, perceptions) to apply them to products
        </p>
      </div>
    )
  }

  return <DataTable columns={taxColumns} data={taxes.data as TaxTableData[]} />
}

function TaxesTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Taxes</h2>
          <p className="text-muted-foreground">
            VAT, perceptions and other taxes
          </p>
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
  const { data: attributes } = useSuspenseQuery(getAttributesQueryOptions())

  if (attributes.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No attributes yet</h3>
        <p className="text-muted-foreground">
          Add attributes (e.g. Color, Size) to define product variants
        </p>
      </div>
    )
  }

  return (
    <DataTable
      columns={attributeColumns}
      data={attributes.data as AttributeTableData[]}
    />
  )
}

function AttributesTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Attributes</h2>
          <p className="text-muted-foreground">
            Attributes and values used to build product variants
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
  const { data: documentTypes } = useSuspenseQuery(
    getDocumentTypesQueryOptions(),
  )

  return (
    <DataTable
      columns={documentTypeColumns}
      data={documentTypes.data as DocumentTypeTableData[]}
    />
  )
}

function DocumentTypesTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Document Types</h2>
        <p className="text-muted-foreground">
          Sales, purchases and other operations. Signs and operation are
          seed-managed; name and prefix are editable.
        </p>
      </div>
      <Suspense fallback={<PendingUsers />}>
        <DocumentTypesTabContent />
      </Suspense>
    </div>
  )
}

function Admin() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">
          Configure your business, users, roles and master catalog data
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="users-roles">Users and Roles</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="taxes">Taxes</TabsTrigger>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
          <TabsTrigger value="document-types">Document Types</TabsTrigger>
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
      </Tabs>
    </div>
  )
}
