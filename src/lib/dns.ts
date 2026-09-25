import { promises as dns } from "node:dns";
import type { DnsRecordStatus, LeadEsp } from "@prisma/client";

export const COMMON_DKIM_SELECTORS = [
  "google", // Google Workspace
  "selector1", // Microsoft 365
  "selector2",
  "default",
  "k1", // Mailchimp / Mailgun
  "mail",
  "dkim",
  "s1",
  "s2",
  "smtp",
  "zoho",
  "mxvault",
];

export interface RecordResult {
  status: DnsRecordStatus;
  record?: string;
  issues: string[];
}

export interface DomainReport {
  domain: string;
  spf: RecordResult;
  dkim: RecordResult & { selector?: string };
  dmarc: RecordResult;
  mx: RecordResult;
  esp: LeadEsp;
  checkedAt: Date;
}

const joinTxt = (chunks: string[][]) => chunks.map((c) => c.join(""));

// ---------------------------------------------------------------------------
// Pure evaluators (unit-tested)
// ---------------------------------------------------------------------------

export function evaluateSpf(txtRecords: string[]): RecordResult {
  const spf = txtRecords.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  if (spf.length === 0) return { status: "MISSING", issues: ["No SPF record found. Add a TXT record starting with v=spf1."] };
  if (spf.length > 1) return { status: "INVALID", record: spf.join(" | "), issues: ["Multiple SPF records found — only one is allowed (RFC 7208)."] };

  const record = spf[0].trim();
  const issues: string[] = [];
  if (/\s\+all(\s|$)/i.test(record)) issues.push("SPF ends in +all, which authorizes every server on the internet.");
  if (!/[~\-?]all(\s|$)/i.test(record) && !/redirect=/i.test(record)) issues.push("SPF has no terminating ~all / -all mechanism.");
  const lookups = (record.match(/\b(include:|a[:\s]|mx[:\s]|ptr|exists:|redirect=)/gi) ?? []).length;
  if (lookups > 10) issues.push(`SPF uses ${lookups} DNS lookups (limit is 10).`);

  const fatal = issues.some((i) => i.includes("+all") || i.includes("limit is 10"));
  return { status: fatal ? "INVALID" : "VALID", record, issues };
}

export function evaluateDmarc(txtRecords: string[]): RecordResult {
  const dmarc = txtRecords.filter((r) => /^v=DMARC1/i.test(r.trim()));
  if (dmarc.length === 0) return { status: "MISSING", issues: ["No DMARC record at _dmarc. Add: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com"] };
  if (dmarc.length > 1) return { status: "INVALID", record: dmarc.join(" | "), issues: ["Multiple DMARC records found."] };
  const record = dmarc[0].trim();
  const policy = /;\s*p=(none|quarantine|reject)/i.exec(record)?.[1]?.toLowerCase();
  if (!policy) return { status: "INVALID", record, issues: ["DMARC record has no valid p= policy."] };
  const issues = policy === "none" ? ["DMARC policy is p=none (monitoring only). Fine for cold email, consider quarantine later."] : [];
  return { status: "VALID", record, issues };
}

export function evaluateDkim(txtRecords: string[]): RecordResult {
  const rec = txtRecords.find((r) => /(^|;)\s*p=/i.test(r));
  if (!rec) return { status: "MISSING", issues: [] };
  if (/(^|;)\s*p=\s*(;|$)/i.test(rec)) return { status: "INVALID", record: rec, issues: ["DKIM key is revoked (empty p=)."] };
  return { status: "VALID", record: rec, issues: [] };
}

export function espFromMx(exchanges: string[]): LeadEsp {
  if (exchanges.length === 0) return "UNKNOWN";
  const all = exchanges.join(" ").toLowerCase();
  if (/(google\.com|googlemail\.com)/.test(all)) return "GOOGLE";
  if (/(outlook\.com|protection\.outlook|hotmail\.com|office365)/.test(all)) return "MICROSOFT";
  return "OTHER";
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

async function txt(name: string): Promise<string[]> {
  try {
    return joinTxt(await dns.resolveTxt(name));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    throw e;
  }
}

async function mx(domain: string): Promise<string[]> {
  try {
    return (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  } catch {
    return [];
  }
}

export async function checkDkim(domain: string, preferred?: string | null): Promise<RecordResult & { selector?: string }> {
  const selectors = preferred ? [preferred, ...COMMON_DKIM_SELECTORS.filter((s) => s !== preferred)] : COMMON_DKIM_SELECTORS;
  for (const selector of selectors) {
    const res = evaluateDkim(await txt(`${selector}._domainkey.${domain}`));
    if (res.status !== "MISSING") return { ...res, selector };
  }
  return {
    status: "MISSING",
    issues: [`No DKIM key found for common selectors (${COMMON_DKIM_SELECTORS.slice(0, 4).join(", ")}…). Set the selector manually if you use a custom one.`],
  };
}

export async function checkDomain(domain: string, dkimSelector?: string | null): Promise<DomainReport> {
  const [rootTxt, dmarcTxt, mxHosts, dkim] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    mx(domain),
    checkDkim(domain, dkimSelector),
  ]);
  return {
    domain,
    spf: evaluateSpf(rootTxt),
    dmarc: evaluateDmarc(dmarcTxt),
    dkim,
    mx: mxHosts.length
      ? { status: "VALID", record: mxHosts.join(", "), issues: [] }
      : { status: "MISSING", issues: ["No MX records — replies to this domain will bounce."] },
    esp: espFromMx(mxHosts),
    checkedAt: new Date(),
  };
}

/** Resolves a recipient's mailbox provider for ESP matching. */
export async function detectEsp(domain: string): Promise<LeadEsp> {
  return espFromMx(await mx(domain));
}

/** True when `host` is a CNAME pointing at `target`. */
export async function verifyCname(host: string, target: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(host);
    return records.some((r) => r.replace(/\.$/, "").toLowerCase() === target.toLowerCase());
  } catch {
    return false;
  }
}
