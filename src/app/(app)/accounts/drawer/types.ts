import type { EmailAccount } from "@prisma/client";

/** What the drawer needs from an inbox — never credentials. */
export type AccountView = Pick<
  EmailAccount,
  | "id"
  | "emailAddress"
  | "fromName"
  | "provider"
  | "status"
  | "lastError"
  | "replyTo"
  | "dailyLimit"
  | "minDelaySeconds"
  | "maxDelaySeconds"
  | "campaignRampUpEnabled"
  | "campaignRampUpStart"
  | "campaignRampUpIncrement"
  | "signature"
  | "trackingDomainId"
  | "salesblinkSenderId"
  | "healthScore"
  | "isWarmupEnabled"
  | "warmupTag"
  | "warmupDailyLimit"
  | "warmupRampUp"
  | "warmupReplyRate"
>;

export const accountViewSelect = {
  id: true,
  emailAddress: true,
  fromName: true,
  provider: true,
  status: true,
  lastError: true,
  replyTo: true,
  dailyLimit: true,
  minDelaySeconds: true,
  maxDelaySeconds: true,
  campaignRampUpEnabled: true,
  campaignRampUpStart: true,
  campaignRampUpIncrement: true,
  signature: true,
  trackingDomainId: true,
  salesblinkSenderId: true,
  healthScore: true,
  isWarmupEnabled: true,
  warmupTag: true,
  warmupDailyLimit: true,
  warmupRampUp: true,
  warmupReplyRate: true,
} as const;
