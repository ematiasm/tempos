import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n"

export interface PermissionOption {
  id: string
  code: string
  description?: string | null
}

interface PermissionPickerProps {
  permissions: PermissionOption[]
  value: string[]
  onChange: (value: string[]) => void
  loading?: boolean
}

function groupPermissionsByResource(permissions: PermissionOption[]) {
  const groups: Record<string, PermissionOption[]> = {}
  for (const perm of permissions) {
    const resource = perm.code.split(".")[0] ?? "other"
    if (!groups[resource]) {
      groups[resource] = []
    }
    groups[resource].push(perm)
  }
  return groups
}

function groupState(
  value: string[],
  perms: PermissionOption[],
): boolean | "indeterminate" {
  const selected = perms.filter((p) => value.includes(p.id)).length
  if (selected === 0) return false
  if (selected === perms.length) return true
  return "indeterminate"
}

const PermissionPicker = ({
  permissions,
  value,
  onChange,
  loading = false,
}: PermissionPickerProps) => {
  const t = useT()
  const groups = groupPermissionsByResource(permissions)

  const togglePermission = (permId: string, checked: boolean) => {
    onChange(
      checked
        ? [...new Set([...value, permId])]
        : value.filter((id) => id !== permId),
    )
  }

  const toggleGroup = (perms: PermissionOption[], checked: boolean) => {
    const next = new Set(value)
    for (const perm of perms) {
      if (checked) {
        next.add(perm.id)
      } else {
        next.delete(perm.id)
      }
    }
    onChange([...next])
  }

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        {t("admin.permissions.selectedCount", {
          selected: value.length,
          total: permissions.length,
        })}
      </p>
      <div className="h-64 w-full overflow-y-auto rounded-md border p-4">
        {loading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {Object.entries(groups).map(([resource, perms]) => (
              <div key={resource} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    aria-label={t("admin.permissions.selectAll", { resource })}
                    checked={groupState(value, perms)}
                    onCheckedChange={(checked) =>
                      toggleGroup(perms, checked === true)
                    }
                  />
                  <p className="text-sm font-semibold capitalize">{resource}</p>
                </div>
                {perms.map((perm) => {
                  const isChecked = value.includes(perm.id)
                  return (
                    <div key={perm.id} className="flex items-center gap-3 ml-4">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) =>
                          togglePermission(perm.id, checked === true)
                        }
                      />
                      <div>
                        <span className="text-sm font-mono">{perm.code}</span>
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default PermissionPicker
