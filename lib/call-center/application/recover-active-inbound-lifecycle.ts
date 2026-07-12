import { createActiveInboundLifecycleRecovery } from "@/lib/call-center/application/reconcile-active-inbound";
import { prismaActiveInboundLifecycleStore } from "@/lib/call-center/infrastructure/prisma-active-inbound-lifecycle-store";

export const recoverActiveInboundLifecycle = createActiveInboundLifecycleRecovery({
  store: prismaActiveInboundLifecycleStore,
});
