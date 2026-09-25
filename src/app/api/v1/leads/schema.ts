import { z } from "zod";

export const apiLead = z.object({
  email: z.string().email(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  companyName: z.string().max(200).optional(),
  linkedinUrl: z.string().max(500).optional(),
  customVariables: z.record(z.string()).optional(),
});
export const apiLeadBatch = z.object({ leads: z.array(apiLead).min(1).max(1000), campaignId: z.string().uuid().optional() });
