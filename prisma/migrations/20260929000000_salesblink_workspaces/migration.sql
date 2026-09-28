-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "salesblinkKeyHash" TEXT,
ADD COLUMN     "salesblinkWorkspaceId" TEXT,
ADD COLUMN     "salesblinkWorkspaceName" TEXT;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_salesblinkKeyHash_key" ON "Workspace"("salesblinkKeyHash");

