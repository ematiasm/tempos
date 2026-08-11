import { BackupsService, OpenAPI } from "@/client"

// The generated client treats binary responses as `unknown`; ask axios for a
// Blob on the download endpoint so the file can be saved from the browser.
OpenAPI.interceptors.request.use((config) => {
  if (config.url?.includes("/backups/") && config.url.endsWith("/download")) {
    config.responseType = "blob"
  }
  return config
})

export async function downloadBackup(
  backupId: string,
  filename: string,
): Promise<void> {
  const blob = (await BackupsService.downloadBackup({
    backupId,
  })) as Blob
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
