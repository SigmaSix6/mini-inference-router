import { z } from "zod"

export const chatBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  debug: z
    .object({
      primaryMode: z.enum(["ok", "error", "hang", "garbage"]).optional(),
      forceTier: z.enum(["fast", "quality"]).optional(),
      tokenDelayMs: z.number().int().min(0).max(2000).optional(),
    })
    .optional(),
})

export type ChatBody = z.infer<typeof chatBodySchema>
