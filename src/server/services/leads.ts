import type { LeadEsp, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { detectEsp } from "@/lib/dns";
import { domainOf } from "@/lib/utils";

export interface LeadInput {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  linkedinUrl?: string;
  customVariables?: Record<string, string>;
}

export interface ImportResult {
  created: number;
  updated: number;
  invalid: number;
  blocked: number;
  addedToCampaign: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_MAIL: Record<string, LeadEsp> = {
  "gmail.com": "GOOGLE",
  "googlemail.com": "GOOGLE",
  "outlook.com": "MICROSOFT",
  "hotmail.com": "MICROSOFT",
  "live.com": "MICROSOFT",
  "msn.com": "MICROSOFT",
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function loadBlocklist(workspaceId: string) {
  const rows = await db.globalBlocklist.findMany({ where: { workspaceId }, select: { emailOrDomain: true } });
  const set = new Set(rows.map((r) => r.emailOrDomain.toLowerCase()));
  return (email: string) => set.has(email) || set.has(domainOf(email));
}

export async function resolveEspForDomains(domains: string[]): Promise<Map<string, LeadEsp>> {
  const map = new Map<string, LeadEsp>();
  const unknown: string[] = [];
  for (const d of domains) {
    if (FREE_MAIL[d]) map.set(d, FREE_MAIL[d]);
    else unknown.push(d);
  }
  const results = await mapLimit(unknown.slice(0, 2000), 25, (d) => detectEsp(d).catch(() => "UNKNOWN" as LeadEsp));
  unknown.slice(0, 2000).forEach((d, i) => map.set(d, results[i]));
  return map;
}

export async function importLeads(workspaceId: string, inputs: LeadInput[], campaignId?: string): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, invalid: 0, blocked: 0, addedToCampaign: 0 };
  const isBlocked = await loadBlocklist(workspaceId);

  // Normalise + dedupe within the file (last row wins).
  const byEmail = new Map<string, LeadInput>();
  for (const raw of inputs) {
    const email = raw.email?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      result.invalid++;
      continue;
    }
    if (isBlocked(email)) {
      result.blocked++;
      continue;
    }
    byEmail.set(email, { ...raw, email });
  }
  const leads = [...byEmail.values()];
  if (leads.length === 0) return result;

  const espMap = await resolveEspForDomains([...new Set(leads.map((l) => domainOf(l.email)))]);
  const existing = new Set(
    (await db.lead.findMany({ where: { workspaceId, email: { in: leads.map((l) => l.email) } }, select: { email: true } })).map((l) => l.email),
  );

  const toCreate: Prisma.LeadCreateManyInput[] = [];
  for (const l of leads) {
    const data = {
      firstName: l.firstName?.trim() || null,
      lastName: l.lastName?.trim() || null,
      companyName: l.companyName?.trim() || null,
      linkedinUrl: l.linkedinUrl?.trim() || null,
      customVariables: l.customVariables && Object.keys(l.customVariables).length ? l.customVariables : undefined,
      esp: espMap.get(domainOf(l.email)) ?? "UNKNOWN",
    };
    if (existing.has(l.email)) {
      await db.lead.update({ where: { workspaceId_email: { workspaceId, email: l.email } }, data });
      result.updated++;
    } else {
      toCreate.push({ workspaceId, email: l.email, ...data });
    }
  }
  if (toCreate.length) result.created = (await db.lead.createMany({ data: toCreate, skipDuplicates: true })).count;

  if (campaignId) {
    const ids = await db.lead.findMany({
      where: { workspaceId, email: { in: leads.map((l) => l.email) }, status: { notIn: ["UNSUBSCRIBED", "BOUNCED"] } },
      select: { id: true },
    });
    result.addedToCampaign = (
      await db.campaignLead.createMany({ data: ids.map((l) => ({ campaignId, leadId: l.id })), skipDuplicates: true })
    ).count;
  }
  return result;
}
