import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { SettingsForm } from "./settings-form";

export default async function CampaignSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const [c, accounts, others] = await Promise.all([
    db.campaign.findFirstOrThrow({ where: { id, workspaceId: workspace.id }, include: { emailAccounts: true } }),
    db.emailAccount.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, emailAddress: true, provider: true, status: true, dailyLimit: true },
      orderBy: { emailAddress: "asc" },
    }),
    db.campaign.findMany({ where: { workspaceId: workspace.id, id: { not: id } }, select: { id: true, name: true } }),
  ]);
  return (
    <SettingsForm
      campaignId={id}
      accounts={accounts}
      campaigns={others}
      initial={{
        trackOpens: c.trackOpens,
        trackClicks: c.trackClicks,
        stopOnReply: c.stopOnReply,
        espMatching: c.espMatching,
        includeUnsubscribe: c.includeUnsubscribe,
        sendAsPlainText: c.sendAsPlainText,
        dailyLeadLimit: c.dailyLeadLimit,
        emailAccountIds: c.emailAccounts.map((a) => a.emailAccountId),
      }}
      subsequence={{ parentCampaignId: c.parentCampaignId, triggerLabel: c.triggerLabel }}
    />
  );
}
