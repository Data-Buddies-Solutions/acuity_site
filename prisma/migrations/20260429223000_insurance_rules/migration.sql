-- CreateEnum
CREATE TYPE "InsuranceRuleSetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InsuranceRuleRevisionSource" AS ENUM ('ADMIN', 'PRACTICE', 'IMPORT');

-- CreateEnum
CREATE TYPE "InsuranceRuleRevisionStatus" AS ENUM ('PENDING_APPROVAL', 'PUBLISHED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AdminAlertType" ADD VALUE IF NOT EXISTS 'INSURANCE_RULES_EDITED';

-- AlterTable
ALTER TABLE "admin_alert" ADD COLUMN "insuranceRuleRevisionId" TEXT;
ALTER TABLE "admin_alert" ADD COLUMN "insuranceRuleSetId" TEXT;

-- CreateTable
CREATE TABLE "practice_insurance_rule_set" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "InsuranceRuleSetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_insurance_rule_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_insurance_rule_revision" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "source" "InsuranceRuleRevisionSource" NOT NULL DEFAULT 'PRACTICE',
    "status" "InsuranceRuleRevisionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "editedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "practice_insurance_rule_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_insurance_rule_set_practiceId_slug_key" ON "practice_insurance_rule_set"("practiceId", "slug");

-- CreateIndex
CREATE INDEX "practice_insurance_rule_set_practiceId_idx" ON "practice_insurance_rule_set"("practiceId");

-- CreateIndex
CREATE INDEX "practice_insurance_rule_set_locationId_idx" ON "practice_insurance_rule_set"("locationId");

-- CreateIndex
CREATE INDEX "practice_insurance_rule_revision_ruleSetId_idx" ON "practice_insurance_rule_revision"("ruleSetId");

-- CreateIndex
CREATE INDEX "practice_insurance_rule_revision_status_idx" ON "practice_insurance_rule_revision"("status");

-- CreateIndex
CREATE INDEX "practice_insurance_rule_revision_createdAt_idx" ON "practice_insurance_rule_revision"("createdAt");

-- CreateIndex
CREATE INDEX "admin_alert_insuranceRuleSetId_idx" ON "admin_alert"("insuranceRuleSetId");

-- CreateIndex
CREATE INDEX "admin_alert_insuranceRuleRevisionId_idx" ON "admin_alert"("insuranceRuleRevisionId");

-- AddForeignKey
ALTER TABLE "practice_insurance_rule_set" ADD CONSTRAINT "practice_insurance_rule_set_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_insurance_rule_set" ADD CONSTRAINT "practice_insurance_rule_set_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_insurance_rule_revision" ADD CONSTRAINT "practice_insurance_rule_revision_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "practice_insurance_rule_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alert" ADD CONSTRAINT "admin_alert_insuranceRuleSetId_fkey" FOREIGN KEY ("insuranceRuleSetId") REFERENCES "practice_insurance_rule_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alert" ADD CONSTRAINT "admin_alert_insuranceRuleRevisionId_fkey" FOREIGN KEY ("insuranceRuleRevisionId") REFERENCES "practice_insurance_rule_revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
