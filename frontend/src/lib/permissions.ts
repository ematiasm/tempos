import type { UserPublic } from "@/client"

export function hasPermission(
  user: UserPublic | null | undefined,
  code: string,
): boolean {
  if (!user) return false
  if (user.is_superuser) return true
  return (
    user.roles?.some((role) =>
      role.permissions?.some((permission) => permission.code === code),
    ) ?? false
  )
}
