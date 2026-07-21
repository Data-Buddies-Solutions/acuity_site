import { prismaOperatorFollowUpStore } from "@/lib/call-center/infrastructure/prisma-operator-follow-up-store";
import { createOperatorFollowUp } from "@/lib/call-center/operator-follow-up";

export const operatorFollowUp = createOperatorFollowUp(prismaOperatorFollowUpStore);
