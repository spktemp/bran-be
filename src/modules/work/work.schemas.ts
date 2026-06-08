import { z } from "zod";

import { WORK_STATUSES } from "./work.constants";

const stepSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  deadline: z.string().datetime().nullable().optional(),
  done: z.boolean().optional()
});

export const createWorkUnitSchema = z.object({
  title: z.string().trim().min(1).max(500),
  context: z.string().trim().min(1).max(8000),
  status: z.enum(WORK_STATUSES).optional(),
  isPrivate: z.boolean().optional(),
  steps: z.array(stepSchema).max(50).optional()
});

export const updateWorkUnitSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  context: z.string().trim().min(1).max(8000).optional(),
  status: z.enum(WORK_STATUSES).optional(),
  isPrivate: z.boolean().optional(),
  steps: z.array(stepSchema).max(50).optional()
});

export const listWorkUnitsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum(WORK_STATUSES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

export const deadlinesQuerySchema = z.object({
  date: z.string().datetime().optional()
});
