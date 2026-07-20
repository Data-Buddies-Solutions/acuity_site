import {
  saveCallCenterConfiguration,
  type CallCenterConfigurationInput,
} from "@/lib/call-center/application/configuration";
import {
  PrismaCallCenterConfigurationRepository,
  readCallCenterConfiguration,
} from "@/lib/call-center/infrastructure/prisma-configuration-repository";

export const callCenterConfiguration = {
  read(practiceId: string) {
    return readCallCenterConfiguration(practiceId);
  },

  save(
    input: CallCenterConfigurationInput,
    expectedVersion: string,
    actorUserId: string,
  ) {
    return saveCallCenterConfiguration(
      new PrismaCallCenterConfigurationRepository(),
      input,
      expectedVersion,
      actorUserId,
    );
  },
};
