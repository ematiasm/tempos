import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import type { UoMPublic } from "@/client"
import { UomsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
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
  name: z.string().min(1, { message: "Name is required" }),
  abbreviation: z
    .string()
    .min(1, { message: "Abbreviation is required" })
    .max(10, { message: "Max 10 characters" }),
  decimal_places: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) =>
        v === "" ||
        v === undefined ||
        (/^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 4),
      { message: "Must be an integer between 0 and 4" },
    ),
})

type FormData = z.infer<typeof formSchema>

interface EditUoMProps {
  uom: UoMPublic
  onSuccess: () => void
}

const EditUoM = ({ uom, onSuccess }: EditUoMProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      name: uom.name,
      abbreviation: uom.abbreviation,
      decimal_places: String(uom.decimal_places ?? 0),
    },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const requestBody = {
        name: data.name,
        abbreviation: data.abbreviation,
        decimal_places: data.decimal_places ? Number(data.decimal_places) : 0,
      }
      return UomsService.updateUom({ uomId: uom.id, requestBody })
    },
    onSuccess: () => {
      showSuccessToast("Unit of measure updated successfully")
      setIsOpen(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["uoms"] })
    },
  })

  const onSubmit = (data: FormData) => mutation.mutate(data)

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
      >
        <Pencil />
        Edit Unit
      </DropdownMenuItem>
      <DialogContent className="sm:max-w-md">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Edit Unit of Measure</DialogTitle>
              <DialogDescription>Update the unit details.</DialogDescription>
            </DialogHeader>
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
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="abbreviation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Abbreviation <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="decimal_places"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Decimal Places</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={4} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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

export default EditUoM
