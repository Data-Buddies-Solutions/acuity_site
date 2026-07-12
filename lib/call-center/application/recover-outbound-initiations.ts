import { prismaOutboundInitiationRecovery } from "@/lib/call-center/infrastructure/prisma-outbound-initiation-recovery";

export const OUTBOUND_INITIATION_RECOVERY_BATCH_SIZE = 25;

export function recoverOutboundInitiations(
  now = new Date(),
  limit = OUTBOUND_INITIATION_RECOVERY_BATCH_SIZE,
) {
  return prismaOutboundInitiationRecovery.recoverDue(now, limit);
}
