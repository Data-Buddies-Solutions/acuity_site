import { createActiveCallDrainer } from "@/lib/call-center/application/drain-active-calls";
import {
  prismaOverdueCallBacklog,
  recoverDueActiveCall,
} from "@/lib/call-center/infrastructure/prisma-overdue-call-recovery";

export const drainActiveCalls = createActiveCallDrainer({
  backlog: prismaOverdueCallBacklog,
  reconcile: recoverDueActiveCall,
});
