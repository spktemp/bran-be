import { z } from "zod";

export const createAdhocWorkSchema = z.object({
  description: z.string().trim().min(1).max(8000),
  output: z.string().trim().min(1).max(8000).optional(),
  effortHours: z.coerce.number().positive().max(999).optional()
});

export const updateAdhocWorkSchema = z.object({
  description: z.string().trim().min(1).max(8000).optional(),
  output: z.string().trim().min(1).max(8000).nullable().optional(),
  effortHours: z.coerce.number().positive().max(999).nullable().optional()
});

export const listAdhocWorkQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});
