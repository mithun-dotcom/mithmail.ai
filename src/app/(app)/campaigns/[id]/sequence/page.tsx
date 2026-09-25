import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { variantSchema, type StepDraft } from "@/lib/campaign-types";
import { aiEnabled } from "@/server/ai";
import { z } from "zod";
import { SequenceEditor } from "./sequence-editor";

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const [steps, sampleLead] = await Promise.all([
    db.campaignStep.findMany({ where: { campaignId: id, campaign: { workspaceId: workspace.id } }, orderBy: { stepNumber: "asc" } }),
    db.campaignLead.findFirst({ where: { campaignId: id }, include: { lead: true } }).then((cl) => cl?.lead ?? null),
  ]);
  const drafts: StepDraft[] = steps.map((s) => ({
    stepNumber: s.stepNumber,
    waitDays: s.waitDays,
    subject: s.subject ?? "",
    body: s.bodySpintax ?? s.bodyHtml ?? "",
    variants: z.array(variantSchema).catch([]).parse(s.abTestVariants ?? []),
  }));
  const sample = {
    first_name: sampleLead?.firstName ?? "Alex",
    last_name: sampleLead?.lastName ?? "Rivera",
    email: sampleLead?.email ?? "alex@northwind.io",
    company_name: sampleLead?.companyName ?? "Northwind",
    ...((sampleLead?.customVariables as Record<string, string> | null) ?? {}),
  };
  return <SequenceEditor campaignId={id} initial={drafts} sample={sample} aiEnabled={aiEnabled()} />;
}
