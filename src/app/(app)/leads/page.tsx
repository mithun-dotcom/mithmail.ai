import Link from "next/link";
import type { LeadStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { LeadImporter } from "./lead-importer";

const PAGE = 50;
const STATUSES: LeadStatus[] = ["UNCONTACTED", "CONTACTED", "REPLIED", "BOUNCED", "UNSUBSCRIBED"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { workspace } = await requireWorkspace();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.LeadWhereInput = { workspaceId: workspace.id };
  if (sp.q) {
    where.OR = [
      { email: { contains: sp.q, mode: "insensitive" } },
      { firstName: { contains: sp.q, mode: "insensitive" } },
      { lastName: { contains: sp.q, mode: "insensitive" } },
      { companyName: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  if (sp.status && STATUSES.includes(sp.status as LeadStatus)) where.status = sp.status as LeadStatus;

  const [leads, total, campaigns] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      include: { campaignLeads: { include: { campaign: { select: { name: true } } } } },
    }),
    db.lead.count({ where }),
    db.campaign.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Leads" description={`${total.toLocaleString()} leads`} />
      <div className="grid gap-6">
        <LeadImporter campaigns={campaigns} />
        <Card>
          <form className="flex flex-wrap gap-2 border-b p-4">
            <Input name="q" defaultValue={sp.q} placeholder="Search name, email, company…" className="max-w-xs" />
            <Select name="status" defaultValue={sp.status ?? ""} className="w-44">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.toLowerCase()}</option>
              ))}
            </Select>
            <Button variant="outline">Filter</Button>
          </form>
          <Table>
            <THead>
              <tr><th>Email</th><th>Name</th><th>Company</th><th>Provider</th><th>Campaigns</th><th>Status</th></tr>
            </THead>
            <TBody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.email}</td>
                  <td>{[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}</td>
                  <td>{l.companyName ?? "—"}</td>
                  <td className="text-xs text-muted-foreground">{l.esp.toLowerCase()}</td>
                  <td className="text-xs">{l.campaignLeads.map((c) => c.campaign.name).join(", ") || "—"}</td>
                  <td><StatusBadge status={l.status} /></td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No leads yet — import a CSV above.</td></tr>
              )}
            </TBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t p-3 text-sm">
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <div className="flex gap-2">
                {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(page - 1)}>Previous</Link>}
                {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(page + 1)}>Next</Link>}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
