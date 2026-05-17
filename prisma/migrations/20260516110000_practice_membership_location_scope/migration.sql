CREATE TYPE "PracticeMembershipLocationScope" AS ENUM ('ALL', 'SELECTED');

ALTER TABLE "practice_membership"
ADD COLUMN "locationScope" "PracticeMembershipLocationScope" NOT NULL DEFAULT 'ALL';

CREATE TABLE "practice_membership_location" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "practice_membership_location_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "practice_membership_location_membershipId_locationId_key"
ON "practice_membership_location"("membershipId", "locationId");

CREATE INDEX "practice_membership_location_locationId_idx"
ON "practice_membership_location"("locationId");

ALTER TABLE "practice_membership_location"
ADD CONSTRAINT "practice_membership_location_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "practice_membership"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "practice_membership_location"
ADD CONSTRAINT "practice_membership_location_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "practice_location"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
