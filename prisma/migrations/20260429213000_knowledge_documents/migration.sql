-- CreateEnum
CREATE TYPE "KnowledgeDocumentType" AS ENUM ('KNOWLEDGE_BASE');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentRevisionSource" AS ENUM ('ADMIN', 'PRACTICE', 'IMPORT');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentRevisionStatus" AS ENUM ('PENDING_APPROVAL', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminAlertType" AS ENUM ('KNOWLEDGE_BASE_EDITED');

-- CreateEnum
CREATE TYPE "AdminAlertStatus" AS ENUM ('UNREAD', 'REVIEWING', 'RESOLVED');

-- CreateTable
CREATE TABLE "practice_knowledge_document" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "documentType" "KnowledgeDocumentType" NOT NULL DEFAULT 'KNOWLEDGE_BASE',
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_knowledge_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_knowledge_document_revision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "source" "KnowledgeDocumentRevisionSource" NOT NULL DEFAULT 'PRACTICE',
    "status" "KnowledgeDocumentRevisionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "editedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "practice_knowledge_document_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_alert" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentId" TEXT,
    "revisionId" TEXT,
    "type" "AdminAlertType" NOT NULL,
    "status" "AdminAlertStatus" NOT NULL DEFAULT 'UNREAD',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "admin_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_knowledge_document_practiceId_slug_key" ON "practice_knowledge_document"("practiceId", "slug");

-- CreateIndex
CREATE INDEX "practice_knowledge_document_practiceId_idx" ON "practice_knowledge_document"("practiceId");

-- CreateIndex
CREATE INDEX "practice_knowledge_document_locationId_idx" ON "practice_knowledge_document"("locationId");

-- CreateIndex
CREATE INDEX "practice_knowledge_document_revision_documentId_idx" ON "practice_knowledge_document_revision"("documentId");

-- CreateIndex
CREATE INDEX "practice_knowledge_document_revision_status_idx" ON "practice_knowledge_document_revision"("status");

-- CreateIndex
CREATE INDEX "practice_knowledge_document_revision_createdAt_idx" ON "practice_knowledge_document_revision"("createdAt");

-- CreateIndex
CREATE INDEX "admin_alert_practiceId_idx" ON "admin_alert"("practiceId");

-- CreateIndex
CREATE INDEX "admin_alert_documentId_idx" ON "admin_alert"("documentId");

-- CreateIndex
CREATE INDEX "admin_alert_revisionId_idx" ON "admin_alert"("revisionId");

-- CreateIndex
CREATE INDEX "admin_alert_status_idx" ON "admin_alert"("status");

-- CreateIndex
CREATE INDEX "admin_alert_type_idx" ON "admin_alert"("type");

-- AddForeignKey
ALTER TABLE "practice_knowledge_document" ADD CONSTRAINT "practice_knowledge_document_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_knowledge_document" ADD CONSTRAINT "practice_knowledge_document_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_knowledge_document_revision" ADD CONSTRAINT "practice_knowledge_document_revision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "practice_knowledge_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alert" ADD CONSTRAINT "admin_alert_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alert" ADD CONSTRAINT "admin_alert_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "practice_knowledge_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alert" ADD CONSTRAINT "admin_alert_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "practice_knowledge_document_revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
