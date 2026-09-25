import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";

export default async function DashboardPage() {
  const { workspace } = await requireWorkspace();
  return <PageHeader title="Dashboard" description={`Overview for ${workspace.name}`} />;
}
