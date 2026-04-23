-- CreateEnum
CREATE TYPE "PracticeMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "PracticeOnboardingStatus" AS ENUM (
    'WEBSITE_PENDING',
    'BASICS_PENDING',
    'PROVIDERS_PENDING',
    'INSURANCE_PENDING',
    'KNOWLEDGE_PENDING',
    'READY_TO_LAUNCH',
    'LIVE'
);

-- CreateEnum
CREATE TYPE "PracticeType" AS ENUM ('OPHTHALMOLOGY', 'OPTOMETRY', 'MIXED', 'OTHER');

-- CreateEnum
CREATE TYPE "WebsiteScanStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "onboardingStatus" "PracticeOnboardingStatus" NOT NULL DEFAULT 'WEBSITE_PENDING',
    "practiceType" "PracticeType" NOT NULL DEFAULT 'OTHER',
    "launchReadyAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_membership" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PracticeMembershipRole" NOT NULL DEFAULT 'OWNER',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_location" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "hoursSummary" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_provider" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "primaryLocationId" TEXT,
    "displayName" TEXT NOT NULL,
    "npi" TEXT,
    "specialtySummary" TEXT,
    "scheduleSummary" TEXT,
    "schedulingNotes" TEXT,
    "speechAliases" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_knowledge_base" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "emergencyNotice" TEXT,
    "urgencyScreeningQuestions" JSONB,
    "urgencyDisposition" TEXT,
    "scopeSummary" TEXT,
    "excludedServices" JSONB,
    "commonQuestions" TEXT,
    "appointmentPrep" TEXT,
    "officePolicies" TEXT,
    "afterHoursRules" TEXT,
    "phrasingRules" TEXT,
    "whatToBring" JSONB,
    "appointmentExpectations" JSONB,
    "operationalNotes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_insurance_crosswalk" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "acceptedPlans" TEXT,
    "exceptions" TEXT,
    "transferRules" TEXT,
    "planRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_insurance_crosswalk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_website_scan" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "scanStatus" "WebsiteScanStatus" NOT NULL,
    "errorMessage" TEXT,
    "extractedData" JSONB,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_website_scan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_membership_practiceId_userId_key" ON "practice_membership"("practiceId", "userId");

-- CreateIndex
CREATE INDEX "practice_membership_practiceId_idx" ON "practice_membership"("practiceId");

-- CreateIndex
CREATE INDEX "practice_membership_userId_idx" ON "practice_membership"("userId");

-- CreateIndex
CREATE INDEX "practice_location_practiceId_idx" ON "practice_location"("practiceId");

-- CreateIndex
CREATE INDEX "practice_provider_practiceId_idx" ON "practice_provider"("practiceId");

-- CreateIndex
CREATE INDEX "practice_provider_primaryLocationId_idx" ON "practice_provider"("primaryLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_knowledge_base_practiceId_key" ON "practice_knowledge_base"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_insurance_crosswalk_practiceId_key" ON "practice_insurance_crosswalk"("practiceId");

-- CreateIndex
CREATE INDEX "practice_website_scan_practiceId_scannedAt_idx" ON "practice_website_scan"("practiceId", "scannedAt");

-- AddForeignKey
ALTER TABLE "practice_membership" ADD CONSTRAINT "practice_membership_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_membership" ADD CONSTRAINT "practice_membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_location" ADD CONSTRAINT "practice_location_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_provider" ADD CONSTRAINT "practice_provider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_provider" ADD CONSTRAINT "practice_provider_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_knowledge_base" ADD CONSTRAINT "practice_knowledge_base_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_insurance_crosswalk" ADD CONSTRAINT "practice_insurance_crosswalk_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_website_scan" ADD CONSTRAINT "practice_website_scan_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
