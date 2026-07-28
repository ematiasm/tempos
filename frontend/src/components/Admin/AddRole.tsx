import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { PermissionsService, RolesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formSchema = z.object({
  name: z.string().min(1, { message: "Role name is required" }),
  description: z.string().optional(),
  permission_ids: z.array(z.string()),
})

type FormData = z.infer<typeof formSchema>

function groupPermissionsByResource(
  permissions: { id: string; code: string; description?: string | null }[],
) {
  const groups: Record<
    string,
    { id: string; code: string; description?: string | null }[]
  > = {}
  for (const perm of permissions) {
    const resource = perm.code.split(".")[0] ?? "other"
    if (!groups[resource]) {
      groups[resource] = []
    }
    groups[resource].push(perm)
  }
  return groups
}

const AddRole = () => {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: permissionsData } = useQuery({
    queryFn: () => PermissionsService.readPermissions({ skip: 0, limit: 1000 }),
    queryKey: ["permissions"],
  })

  const permissions = permissionsData?.data ?? []
  const permissionGroups = groupPermissionsByResource(permissions)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      name: "",
      description: "",
      permission_ids: [],
    },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      RolesService.createRole({
        requestBody: {
          name: data.name,
          description: data.description || null,
          permission_ids: data.permission_ids,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Role created successfully")
      form.reset()
      setIsOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  const togglePermission = (permId: string, checked: boolean) => {
    const current = form.getValues("permission_ids")
    if (checked) {
      form.setValue("permission_ids", [...current, permId])
    } else {
      form.setValue(
        "permission_ids",
        current.filter((id) => id !== permId),
      )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="my-4">
          <Plus className="mr-2" />
          Add Role
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Role</DialogTitle>
          <DialogDescription>
            Create a new role and assign permissions to it.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Role name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input placeholder="Role description" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <FormLabel>Permissions</FormLabel>
                <div className="h-64 w-full overflow-y-auto rounded-md border p-4">
                  <div className="flex flex-col gap-4">
                    {Object.entries(permissionGroups).map(
                      ([resource, perms]) => (
                        <div key={resource} className="flex flex-col gap-2">
                          <p className="text-sm font-semibold capitalize">
                            {resource}
                          </p>
                          {perms.map((perm) => {
                            const isChecked = form
                              .getValues("permission_ids")
                              .includes(perm.id)
                            return (
                              <div
                                key={perm.id}
                                className="flex items-center gap-3 ml-4"
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) =>
                                    togglePermission(perm.id, checked === true)
                                  }
                                />
                                <div>
                                  <span className="text-sm font-mono">
                                    {perm.code}
                                  </span>
                                  {perm.description && (
                                    <p className="text-xs text-muted-foreground">
                                      {perm.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={mutation.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton type="submit" loading={mutation.isPending}>
                Save
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default AddRole
