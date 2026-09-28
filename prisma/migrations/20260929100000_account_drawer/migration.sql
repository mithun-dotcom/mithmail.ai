-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN "replyTo" TEXT,
ADD COLUMN "campaignRampUpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "campaignRampUpStart" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "campaignRampUpIncrement" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "campaignRampUpStartedAt" TIMESTAMP(3),
ADD COLUMN "warmupTag" TEXT;
