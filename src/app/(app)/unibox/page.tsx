import Link from "next/link";
import type { Prisma, ThreadSummaryStatus } from "@prisma/client";
import { formatDistanceToNowStrict, format } from "date-fns";
import { db } from "@/lib/db";
import { htmlToText } from "@/lib/template";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/workspace";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { stripQuoted } from "@/server/inbox/reply-processor";
import { ThreadActions } from "./thread-actions";
import { ReplyBox } from "./reply-box";

const FILTERS: { key: string; label: string; labels?: ThreadSummaryStatus[] }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "interested", label: "Interested", labels: ["INTERESTED"] },
  { key: "meeting", label: "Meeting booked", labels: ["MEETING_BOOKED"] },
  { key: "not_interested", label: "Not interested", labels: ["NOT_INTERESTED"] },
  { key: "ooo", label: "Out of office", labels: ["OUT_OF_OFFICE"] },
  { key: "other", label: "Other", labels: ["WRONG_PERSON", "UNSUBSCRIBE_REQUEST", "NEUTRAL"] },
];

export default async function UniboxPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; t?: string; c?: string; a?: string }> }) {
  const { workspace } = await requireWorkspace();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0];

  const where: Prisma.ThreadWhereInput = { workspaceId: workspace.id };
  if (filter.key === "unread") where.isRead = false;
  if (filter.labels) where.summaryStatus = { in: filter.labels };
  if (sp.q) where.OR = [{ leadEmail: { contains: sp.q, mode: "insensitive" } }, { subject: { contains: sp.q, mode: "insensitive" } }];
  if (sp.c) where.campaignId = sp.c;
  if (sp.a) where.messages = { some: { emailAccountId: sp.a } };

  const [threads, counts, campaigns, inboxes] = await Promise.all([
    db.thread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: {
        lead: { select: { firstName: true, lastName: true, companyName: true } },
        messages: { orderBy: { receivedAt: "desc" }, take: 1, select: { body: true, direction: true } },
      },
    }),
    db.thread.groupBy({ by: ["summaryStatus"], where: { workspaceId: workspace.id, isRead: false }, _count: true }),
    db.campaign.findMany({ where: { workspaceId: workspace.id, threads: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.emailAccount.findMany({ where: { workspaceId: workspace.id }, select: { id: true, emailAddress: true }, orderBy: { emailAddress: "asc" } }),
  ]);
  const unread = counts.reduce((n, c) => n + c._count, 0);
  const activeId = sp.t ?? threads[0]?.id;
  const active = activeId
    ? await db.thread.findFirst({
        where: { id: activeId, workspaceId: workspace.id },
        include: {
          messages: { orderBy: { receivedAt: "asc" }, include: { emailAccount: { select: { emailAddress: true } } } },
          lead: true,
          campaign: { select: { id: true, name: true } },
        },
      })
    : null;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { f: sp.f, q: sp.q, t: sp.t, c: sp.c, a: sp.a, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `?${p}`;
  };

  return (
    <div className="-m-4 flex h-[calc(100vh-6.5rem)] md:-m-8 md:h-screen">
      {/* Thread list */}
      <div className={cn("w-full shrink-0 flex-col border-r bg-white md:flex md:w-[380px]", sp.t ? "hidden" : "flex")}>
        <div className="border-b p-4">
          <h1 className="text-lg font-semibold text-royal-950">Unibox <span className="text-sm font-normal text-muted-foreground">· {unread} unread</span></h1>
          <form className="mt-3 grid gap-2">
            {sp.f && <input type="hidden" name="f" value={sp.f} />}
            <Input name="q" defaultValue={sp.q} placeholder="Search email or subject…" />
            <div className="flex gap-2">
              <Select name="c" defaultValue={sp.c ?? ""} className="h-8 text-xs">
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <Select name="a" defaultValue={sp.a ?? ""} className="h-8 text-xs">
                <option value="">All inboxes</option>
                {inboxes.map((a) => (
                  <option key={a.id} value={a.id}>{a.emailAddress}</option>
                ))}
              </Select>
              <Button size="sm" variant="outline">Go</Button>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={qs({ f: f.key === "all" ? undefined : f.key, t: undefined })}
                className={cn("rounded-full px-2.5 py-1 text-xs", filter.key === f.key ? "bg-royal-600 text-white" : "bg-muted text-muted-foreground hover:bg-royal-50")}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.map((t) => {
            const preview = htmlToText(t.messages[0]?.body ?? "").slice(0, 110);
            const name = [t.lead?.firstName, t.lead?.lastName].filter(Boolean).join(" ") || t.leadEmail;
            return (
              <Link
                key={t.id}
                href={qs({ t: t.id })}
                className={cn("block border-b px-4 py-3 hover:bg-muted/50", t.id === activeId && "bg-royal-50", !t.isRead && "border-l-4 border-l-gold-400")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", !t.isRead && "font-semibold")}>{name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDistanceToNowStrict(t.lastMessageAt)}</span>
                </div>
                <p className="truncate text-xs text-royal-800">{t.subject}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
                {t.summaryStatus && <div className="mt-1"><StatusBadge status={t.summaryStatus} /></div>}
              </Link>
            );
          })}
          {threads.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No conversations here yet.</p>}
        </div>
      </div>

      {/* Conversation */}
      <div className={cn("min-w-0 flex-1 flex-col bg-muted/30 md:flex", sp.t ? "flex" : "hidden")}>
        {active ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4">
              <div className="min-w-0">
                <Link href={qs({ t: undefined })} className="mb-1 block text-xs text-royal-700 md:hidden">← All conversations</Link>
                <p className="truncate font-semibold">{active.subject}</p>
                <p className="text-sm text-muted-foreground">
                  {active.leadEmail}
                  {active.lead?.companyName && ` · ${active.lead.companyName}`}
                  {active.campaign && (
                    <>
                      {" · "}
                      <Link href={`/campaigns/${active.campaign.id}`} className="text-royal-700 hover:underline">{active.campaign.name}</Link>
                    </>
                  )}
                </p>
              </div>
              <ThreadActions id={active.id} label={active.summaryStatus} isRead={active.isRead} />
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {active.messages.map((m) => (
                <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-3 shadow-sm",
                      m.direction === "OUTBOUND" ? "rounded-br-sm bg-royal-700 text-white" : "rounded-bl-sm border bg-white",
                    )}
                  >
                    <p className={cn("mb-1 text-[11px]", m.direction === "OUTBOUND" ? "text-royal-200" : "text-muted-foreground")}>
                      {m.direction === "OUTBOUND" ? `${m.emailAccount?.emailAddress ?? m.fromEmail} →` : m.fromEmail} · {format(m.receivedAt, "MMM d, HH:mm")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {m.direction === "INBOUND" ? stripQuoted(htmlToText(m.body)) || htmlToText(m.body) : htmlToText(m.body)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <ReplyBox threadId={active.id} key={active.id} />
          </>
        ) : (
          <div className="m-auto max-w-md">
            <EmptyState title="Replies land here" description="Every reply from every connected inbox appears in the Unibox, labelled by intent." />
          </div>
        )}
      </div>
    </div>
  );
}
