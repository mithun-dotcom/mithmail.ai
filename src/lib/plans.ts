import type { SubscriptionTier } from "@prisma/client";

/**
 * Plan limits. Inboxes are effectively unlimited on paid plans — MithMill's model is
 * "many inboxes at low volume" — so plans meter emails per month instead.
 */
export const PLANS: Record<SubscriptionTier, { label: string; maxInboxes: number; monthlyEmailQuota: number }> = {
  FREE: { label: "Free trial", maxInboxes: 3, monthlyEmailQuota: 1_000 },
  STARTER: { label: "Starter", maxInboxes: 10_000, monthlyEmailQuota: 25_000 },
  GROWTH: { label: "Growth", maxInboxes: 10_000, monthlyEmailQuota: 150_000 },
  SCALE: { label: "Scale", maxInboxes: 10_000, monthlyEmailQuota: 500_000 },
  ENTERPRISE: { label: "Enterprise", maxInboxes: 100_000, monthlyEmailQuota: 5_000_000 },
};
