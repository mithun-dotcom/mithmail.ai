import { db } from "@/lib/db";
import { checkDomain } from "@/lib/dns";
import { domainOf } from "@/lib/utils";

/** Runs a DNS check for one inbox's domain and persists the result. */
export async function refreshDomainHealth(emailAccountId: string) {
  const account = await db.emailAccount.findUniqueOrThrow({
    where: { id: emailAccountId },
    include: { domainHealth: true },
  });
  const domain = domainOf(account.emailAddress);
  const report = await checkDomain(domain, account.domainHealth?.dkimSelector);

  const data = {
    domain,
    spfStatus: report.spf.status,
    dkimStatus: report.dkim.status,
    dmarcStatus: report.dmarc.status,
    mxStatus: report.mx.status,
    spfRecord: report.spf.record ?? null,
    dmarcRecord: report.dmarc.record ?? null,
    dkimSelector: report.dkim.selector ?? account.domainHealth?.dkimSelector ?? null,
    lastCheckedAt: report.checkedAt,
  };
  await db.domainHealth.upsert({
    where: { emailAccountId },
    create: { emailAccountId, ...data },
    update: data,
  });
  return report;
}

/** Checks each distinct domain once, then fans the result out to every inbox on it. */
export async function refreshAllDomainHealth() {
  const accounts = await db.emailAccount.findMany({ select: { id: true, emailAddress: true } });
  const byDomain = new Map<string, string[]>();
  for (const a of accounts) {
    const d = domainOf(a.emailAddress);
    byDomain.set(d, [...(byDomain.get(d) ?? []), a.id]);
  }
  let checked = 0;
  for (const ids of byDomain.values()) {
    const [first, ...rest] = ids;
    await refreshDomainHealth(first);
    const health = await db.domainHealth.findUniqueOrThrow({ where: { emailAccountId: first } });
    const { id: _id, emailAccountId: _e, ...copy } = health;
    for (const id of rest) {
      await db.domainHealth.upsert({ where: { emailAccountId: id }, create: { ...copy, emailAccountId: id }, update: copy });
    }
    checked++;
  }
  return { domains: checked, accounts: accounts.length };
}
