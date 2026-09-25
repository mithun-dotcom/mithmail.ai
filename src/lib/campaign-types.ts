import { z } from "zod";

export const variantSchema = z.object({
  id: z.string().min(1).max(20),
  subject: z.string().max(300),
  body: z.string().max(20000),
  weight: z.number().int().min(0).max(100).default(50),
});
export type Variant = z.infer<typeof variantSchema>;

export const stepSchema = z.object({
  stepNumber: z.number().int().min(1),
  waitDays: z.number().int().min(0).max(60),
  subject: z.string().max(300),
  body: z.string().max(20000),
  variants: z.array(variantSchema).max(4).default([]),
});
export type StepDraft = z.infer<typeof stepSchema>;

export const scheduleSchema = z.object({
  timezone: z.string().min(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one sending day"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});
export type ScheduleDraft = z.infer<typeof scheduleSchema>;

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
