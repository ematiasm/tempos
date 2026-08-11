import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarClock, CheckCircle2, XCircle } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { type BackupScheduleUpdate, BackupsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { type MessageId, useLocale, useT } from "@/i18n"
import { handleError } from "@/utils"

const formSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    run_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
      message: "Invalid time",
    }),
    day_of_week: z.string().optional(),
    day_of_month: z.string().optional(),
    retention: z
      .string()
      .regex(/^\d+$/, { message: "Invalid number" })
      .refine((value) => Number(value) >= 1, {
        message: "Must be at least 1",
      }),
  })
  .superRefine((data, ctx) => {
    if (data.frequency === "weekly" && !data.day_of_week) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["day_of_week"],
        message: "Required",
      })
    }
    if (data.frequency === "monthly" && !data.day_of_month) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["day_of_month"],
        message: "Required",
      })
    }
  })

type FormData = z.infer<typeof formSchema>

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1)

const WEEKDAY_KEYS: Record<number, MessageId> = {
  0: "admin.backups.schedule.weekdayMonday",
  1: "admin.backups.schedule.weekdayTuesday",
  2: "admin.backups.schedule.weekdayWednesday",
  3: "admin.backups.schedule.weekdayThursday",
  4: "admin.backups.schedule.weekdayFriday",
  5: "admin.backups.schedule.weekdaySaturday",
  6: "admin.backups.schedule.weekdaySunday",
}

function BackupScheduleForm() {
  const t = useT()
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [isEditing, setIsEditing] = useState(false)

  const { data: schedule } = useQuery({
    queryFn: () => BackupsService.readBackupSchedule(),
    queryKey: ["backup-schedule"],
    enabled: true,
  })

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      enabled: schedule?.enabled ?? true,
      frequency: schedule?.frequency ?? "daily",
      run_time: schedule?.run_time ?? "03:00",
      day_of_week: schedule?.day_of_week?.toString(),
      day_of_month: schedule?.day_of_month?.toString(),
      retention: schedule?.retention.toString() ?? "14",
    },
    values: schedule
      ? {
          enabled: schedule.enabled,
          frequency: schedule.frequency,
          run_time: schedule.run_time,
          day_of_week: schedule.day_of_week?.toString(),
          day_of_month: schedule.day_of_month?.toString(),
          retention: schedule.retention.toString(),
        }
      : undefined,
  })

  const frequency = form.watch("frequency")

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const requestBody: BackupScheduleUpdate = {
        enabled: data.enabled,
        frequency: data.frequency,
        run_time: data.run_time,
        retention: Number(data.retention),
      }
      if (data.frequency === "weekly") {
        requestBody.day_of_week = Number(data.day_of_week)
      }
      if (data.frequency === "monthly") {
        requestBody.day_of_month = Number(data.day_of_month)
      }
      return BackupsService.updateBackupSchedule({ requestBody })
    },
    onSuccess: () => {
      showSuccessToast(t("admin.backups.schedule.saved"))
      setIsEditing(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["backup-schedule"] })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  if (!schedule) {
    return <div className="text-muted-foreground">{t("common.loading")}</div>
  }

  const formatDate = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleString(locale)
      : t("admin.backups.schedule.never")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {t("admin.backups.schedule.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.backups.schedule.subtitle")}
          </p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)}>{t("common.edit")}</Button>
        )}
      </div>

      <div className="grid gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          <span className="font-medium text-foreground">
            {t("admin.backups.schedule.nextRun")}:
          </span>{" "}
          {formatDate(schedule.next_run_at)}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {t("admin.backups.schedule.lastRun")}:
          </span>{" "}
          {formatDate(schedule.last_run_at)}
          {schedule.last_status === "success" && (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
          {schedule.last_status === "failed" && (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
        </div>
        {schedule.last_error && (
          <p className="text-red-500">{schedule.last_error}</p>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-4 max-w-2xl">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!isEditing}
                    />
                  </FormControl>
                  <div>
                    <FormLabel className="font-normal">
                      {t("admin.backups.schedule.enabled")}
                    </FormLabel>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.backups.schedule.enabledHint")}
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.backups.schedule.frequency")}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("admin.backups.schedule.frequency")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="daily">
                          {t("admin.backups.schedule.frequencyDaily")}
                        </SelectItem>
                        <SelectItem value="weekly">
                          {t("admin.backups.schedule.frequencyWeekly")}
                        </SelectItem>
                        <SelectItem value="monthly">
                          {t("admin.backups.schedule.frequencyMonthly")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="run_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.backups.schedule.time")}</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} disabled={!isEditing} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {frequency === "weekly" && (
              <FormField
                control={form.control}
                name="day_of_week"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.backups.schedule.dayOfWeek")}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("admin.backups.schedule.dayOfWeek")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {WEEKDAYS.map((day) => (
                          <SelectItem key={day} value={day.toString()}>
                            {t(WEEKDAY_KEYS[day])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {frequency === "monthly" && (
              <FormField
                control={form.control}
                name="day_of_month"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.backups.schedule.dayOfMonth")}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("admin.backups.schedule.dayOfMonth")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MONTH_DAYS.map((day) => (
                          <SelectItem key={day} value={day.toString()}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="retention"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.backups.schedule.retention")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      disabled={!isEditing}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("admin.backups.schedule.retentionHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {isEditing && (
            <div className="flex gap-2 mt-6">
              <LoadingButton type="submit" loading={mutation.isPending}>
                {t("admin.general.saveChanges")}
              </LoadingButton>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditing(false)
                  form.reset()
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </form>
      </Form>
    </div>
  )
}

export default BackupScheduleForm
