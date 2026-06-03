-- Add Spring Hill SMS command-center storage.
CREATE TYPE "SmsConversationStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "SmsMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "SmsMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED');

ALTER TABLE "practice_phone_number"
ADD COLUMN "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "telnyxCampaignId" TEXT,
ADD COLUMN "telnyxSmsStatus" TEXT;

CREATE TABLE "sms_conversation" (
  "id" TEXT NOT NULL,
  "practiceId" TEXT NOT NULL,
  "locationId" TEXT,
  "practiceNumberId" TEXT NOT NULL,
  "patientPhoneNumber" TEXT NOT NULL,
  "status" "SmsConversationStatus" NOT NULL DEFAULT 'OPEN',
  "lastMessageAt" TIMESTAMP(3) NOT NULL,
  "lastInboundAt" TIMESTAMP(3),
  "optedOut" BOOLEAN NOT NULL DEFAULT false,
  "optedOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sms_conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sms_message" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "direction" "SmsMessageDirection" NOT NULL,
  "status" "SmsMessageStatus" NOT NULL,
  "body" TEXT NOT NULL,
  "fromNumber" TEXT NOT NULL,
  "toNumber" TEXT NOT NULL,
  "telnyxMessageId" TEXT,
  "errorCode" TEXT,
  "errorDetail" TEXT,
  "sentByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),

  CONSTRAINT "sms_message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sms_conversation_read" (
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sms_conversation_read_pkey" PRIMARY KEY ("conversationId", "userId")
);

CREATE TABLE "sms_opt_out" (
  "id" TEXT NOT NULL,
  "practiceNumberId" TEXT NOT NULL,
  "patientPhoneNumber" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "optedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_opt_out_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sms_conversation_practiceNumberId_patientPhoneNumber_key"
ON "sms_conversation"("practiceNumberId", "patientPhoneNumber");

CREATE INDEX "sms_conversation_practiceId_lastMessageAt_idx"
ON "sms_conversation"("practiceId", "lastMessageAt" DESC);

CREATE INDEX "sms_conversation_locationId_status_lastMessageAt_idx"
ON "sms_conversation"("locationId", "status", "lastMessageAt" DESC);

CREATE UNIQUE INDEX "sms_message_telnyxMessageId_key"
ON "sms_message"("telnyxMessageId");

CREATE INDEX "sms_message_conversationId_createdAt_idx"
ON "sms_message"("conversationId", "createdAt");

CREATE INDEX "sms_message_telnyxMessageId_idx"
ON "sms_message"("telnyxMessageId");

CREATE INDEX "sms_conversation_read_userId_lastReadAt_idx"
ON "sms_conversation_read"("userId", "lastReadAt");

CREATE UNIQUE INDEX "sms_opt_out_practiceNumberId_patientPhoneNumber_key"
ON "sms_opt_out"("practiceNumberId", "patientPhoneNumber");

CREATE INDEX "practice_phone_number_smsEnabled_idx"
ON "practice_phone_number"("smsEnabled");

ALTER TABLE "sms_conversation"
ADD CONSTRAINT "sms_conversation_practiceId_fkey"
FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_conversation"
ADD CONSTRAINT "sms_conversation_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sms_conversation"
ADD CONSTRAINT "sms_conversation_practiceNumberId_fkey"
FOREIGN KEY ("practiceNumberId") REFERENCES "practice_phone_number"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_message"
ADD CONSTRAINT "sms_message_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "sms_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_message"
ADD CONSTRAINT "sms_message_sentByUserId_fkey"
FOREIGN KEY ("sentByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sms_conversation_read"
ADD CONSTRAINT "sms_conversation_read_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "sms_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_conversation_read"
ADD CONSTRAINT "sms_conversation_read_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_opt_out"
ADD CONSTRAINT "sms_opt_out_practiceNumberId_fkey"
FOREIGN KEY ("practiceNumberId") REFERENCES "practice_phone_number"("id") ON DELETE CASCADE ON UPDATE CASCADE;
