-- CreateEnum
CREATE TYPE "SendingEngine" AS ENUM ('BUILTIN', 'SALESBLINK');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "engine" "SendingEngine" NOT NULL DEFAULT 'BUILTIN',
ADD COLUMN     "sbLaunchError" TEXT,
ADD COLUMN     "sbLaunchState" TEXT,
ADD COLUMN     "sbListId" TEXT,
ADD COLUMN     "sbSequenceId" TEXT;

-- AlterTable
ALTER TABLE "CampaignLead" ADD COLUMN     "sbPushedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignStep" ADD COLUMN     "sbTemplateId" TEXT;

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "externalStats" JSONB,
ADD COLUMN     "externalSyncedAt" TIMESTAMP(3),
ADD COLUMN     "healthScore" INTEGER,
ADD COLUMN     "salesblinkSenderId" TEXT;

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "salesblinkApiKeyEnc" TEXT,
ADD COLUMN     "salesblinkSyncState" JSONB,
ADD COLUMN     "sendingEngine" "SendingEngine" NOT NULL DEFAULT 'BUILTIN';

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_workspaceId_salesblinkSenderId_key" ON "EmailAccount"("workspaceId", "salesblinkSenderId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_externalId_key" ON "EmailLog"("externalId");

