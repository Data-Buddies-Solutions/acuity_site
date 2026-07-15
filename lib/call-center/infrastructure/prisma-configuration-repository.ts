import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  callCenterConfigurationVersion,
  callCenterMembershipKey,
  collectCallCenterConfigurationReferences,
  type CallCenterConfigurationAudit,
  type CallCenterConfigurationReferences,
  type CallCenterConfigurationRepository,
  type CallCenterConfigurationTransaction,
  type CallCenterConfigurationValidationContext,
  type ValidatedCallCenterConfiguration,
} from "@/lib/call-center/application/configuration";
import { prisma } from "@/lib/prisma";

export type ConfigurationPrismaTransaction = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "practice"
  | "practiceLocation"
  | "practicePhoneNumber"
  | "practiceMembership"
  | "callCenterQueue"
  | "callCenterNumber"
  | "callCenterEndpoint"
  | "callCenterEvent"
  | "callCenterQueueLocation"
  | "callCenterQueueMember"
  | "practiceCallCenterSettings"
>;

export type ConfigurationTransactionRunner = <T>(
  operation: (transaction: ConfigurationPrismaTransaction) => Promise<T>,
) => Promise<T>;

export type ConfigurationReadClient = Pick<PrismaClient, "practice">;

export type VersionedCallCenterConfiguration = {
  configuration: ValidatedCallCenterConfiguration;
  version: string;
};

const runPrismaTransaction: ConfigurationTransactionRunner = (operation) =>
  prisma.$transaction((transaction) => operation(transaction), {
    isolationLevel: "ReadCommitted",
    maxWait: 5_000,
    timeout: 30_000,
  });

function ownerMap(rows: Array<{ id: string; practiceId: string }>) {
  return new Map(rows.map(({ id, practiceId }) => [id, practiceId]));
}

export async function loadConfigurationValidationContext(
  transaction: ConfigurationPrismaTransaction,
  practiceId: string,
  references: CallCenterConfigurationReferences,
): Promise<CallCenterConfigurationValidationContext> {
  const lockedPractice = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "practice"
    WHERE "id" = ${practiceId}
    FOR UPDATE
  `;

  const currentConfiguration = await readCallCenterConfiguration(practiceId, transaction);
  const currentReferences = currentConfiguration
    ? collectCallCenterConfigurationReferences(currentConfiguration.configuration)
    : null;
  const mergeReferences = (submitted: string[], current: string[] | undefined) => [
    ...new Set(submitted.concat(current ?? [])),
  ];
  const effectiveReferences: CallCenterConfigurationReferences = {
    queueIds: mergeReferences(references.queueIds, currentReferences?.queueIds),
    numberIds: mergeReferences(references.numberIds, currentReferences?.numberIds),
    endpointIds: mergeReferences(references.endpointIds, currentReferences?.endpointIds),
    locationIds: mergeReferences(references.locationIds, currentReferences?.locationIds),
    practicePhoneNumberIds: mergeReferences(
      references.practicePhoneNumberIds,
      currentReferences?.practicePhoneNumberIds,
    ),
    providerNumberIds: mergeReferences(
      references.providerNumberIds,
      currentReferences?.providerNumberIds,
    ),
    memberUserIds: mergeReferences(
      references.memberUserIds,
      currentReferences?.memberUserIds,
    ),
    providerCredentialIds: mergeReferences(
      references.providerCredentialIds,
      currentReferences?.providerCredentialIds,
    ),
    sipUsernames: mergeReferences(
      references.sipUsernames,
      currentReferences?.sipUsernames,
    ),
  };

  const endpointLookup =
    effectiveReferences.endpointIds.length ||
    effectiveReferences.providerCredentialIds.length ||
    effectiveReferences.sipUsernames.length
      ? transaction.callCenterEndpoint.findMany({
          select: {
            id: true,
            practiceId: true,
            providerCredentialId: true,
            sipUsername: true,
          },
          where: {
            OR: [
              { id: { in: effectiveReferences.endpointIds } },
              {
                providerCredentialId: {
                  in: effectiveReferences.providerCredentialIds,
                },
              },
              { sipUsername: { in: effectiveReferences.sipUsernames } },
            ],
          },
        })
      : Promise.resolve([]);
  const [locations, phoneNumbers, memberships, queues, numbers, endpoints] =
    await Promise.all([
      transaction.practiceLocation.findMany({
        select: { id: true },
        where: { id: { in: effectiveReferences.locationIds }, practiceId },
      }),
      transaction.practicePhoneNumber.findMany({
        select: { id: true, locationId: true },
        where: {
          id: { in: effectiveReferences.practicePhoneNumberIds },
          practiceId,
        },
      }),
      transaction.practiceMembership.findMany({
        select: { userId: true },
        where: { practiceId, userId: { in: effectiveReferences.memberUserIds } },
      }),
      transaction.callCenterQueue.findMany({
        select: { id: true, practiceId: true },
        where: { id: { in: effectiveReferences.queueIds } },
      }),
      effectiveReferences.numberIds.length || effectiveReferences.providerNumberIds.length
        ? transaction.callCenterNumber.findMany({
            select: { id: true, practiceId: true, providerNumberId: true },
            where: {
              OR: [
                { id: { in: effectiveReferences.numberIds } },
                { providerNumberId: { in: effectiveReferences.providerNumberIds } },
              ],
            },
          })
        : Promise.resolve([]),
      endpointLookup,
    ]);

  return {
    practiceExists: lockedPractice.length === 1,
    configurationVersion: currentConfiguration?.version ?? "",
    ownedLocationIds: new Set(locations.map(({ id }) => id)),
    ownedPracticePhoneNumberIds: new Set(phoneNumbers.map(({ id }) => id)),
    practicePhoneNumberLocationIds: new Map(
      phoneNumbers.map(({ id, locationId }) => [id, locationId]),
    ),
    practiceMemberUserIds: new Set(memberships.map(({ userId }) => userId)),
    queueOwnerPracticeIds: ownerMap(queues),
    numberOwnerPracticeIds: ownerMap(numbers),
    endpointOwnerPracticeIds: ownerMap(endpoints),
    providerCredentialEndpointIds: new Map(
      endpoints.flatMap(({ id, providerCredentialId }) =>
        providerCredentialId ? [[providerCredentialId, id] as const] : [],
      ),
    ),
    providerNumberOwnerNumberIds: new Map(
      numbers.flatMap(({ id, providerNumberId }) =>
        providerNumberId ? [[providerNumberId, id] as const] : [],
      ),
    ),
    sipUsernameEndpointIds: new Map(
      endpoints.flatMap(({ id, sipUsername }) =>
        sipUsername ? [[sipUsername, id] as const] : [],
      ),
    ),
    enabledQueueIds: new Set(
      currentConfiguration?.configuration.queues
        .filter(({ enabled }) => enabled)
        .map(({ id }) => id) ?? [],
    ),
    enabledNumberIds: new Set(
      currentConfiguration?.configuration.numbers
        .filter(({ enabled }) => enabled)
        .map(({ id }) => id) ?? [],
    ),
    enabledEndpointIds: new Set(
      currentConfiguration?.configuration.endpoints
        .filter(({ enabled }) => enabled)
        .map(({ id }) => id) ?? [],
    ),
    enabledMembershipKeys: new Set(
      currentConfiguration?.configuration.queues.flatMap((queue) =>
        queue.members.flatMap(({ enabled, userId }) =>
          enabled ? [callCenterMembershipKey(queue.id, userId)] : [],
        ),
      ) ?? [],
    ),
    currentConfiguration: currentConfiguration?.configuration ?? null,
  };
}

export async function persistConfigurationSnapshot(
  transaction: ConfigurationPrismaTransaction,
  configuration: ValidatedCallCenterConfiguration,
  audit: CallCenterConfigurationAudit,
) {
  const queueIds = configuration.queues.map(({ id }) => id);

  for (const queue of configuration.queues) {
    const data = {
      enabled: queue.enabled,
      maxWaitSec: queue.maxWaitSec,
      name: queue.name,
      overflowQueueId: null,
      ringTimeoutSec: queue.ringTimeoutSec,
      voicemailEnabled: queue.voicemailEnabled,
      voicemailGreeting: queue.voicemailGreeting,
      wrapUpSec: queue.wrapUpSec,
    };
    await transaction.callCenterQueue.upsert({
      create: { ...data, id: queue.id, practiceId: configuration.practiceId },
      update: data,
      where: { id: queue.id },
    });
  }

  await transaction.callCenterQueueLocation.deleteMany({
    where: { queueId: { in: queueIds } },
  });
  const queueLocations = configuration.queues.flatMap((queue) =>
    queue.locationIds.map((locationId) => ({ locationId, queueId: queue.id })),
  );
  if (queueLocations.length) {
    await transaction.callCenterQueueLocation.createMany({
      data: queueLocations,
    });
  }

  await transaction.callCenterQueueMember.updateMany({
    data: { enabled: false },
    where: { queueId: { in: queueIds } },
  });
  for (const queue of configuration.queues) {
    for (const member of queue.members) {
      await transaction.callCenterQueueMember.upsert({
        create: { ...member, queueId: queue.id },
        update: { enabled: member.enabled, role: member.role },
        where: {
          queueId_userId: { queueId: queue.id, userId: member.userId },
        },
      });
    }
  }

  for (const number of configuration.numbers) {
    const data = {
      enabled: number.enabled,
      inboundEnabled: number.inboundEnabled,
      inboundQueueId: number.inboundQueueId,
      outboundEnabled: number.outboundEnabled,
      practicePhoneNumberId: number.practicePhoneNumberId,
      providerNumberId: number.providerNumberId,
    };
    await transaction.callCenterNumber.upsert({
      create: { ...data, id: number.id, practiceId: configuration.practiceId },
      update: data,
      where: { id: number.id },
    });
  }

  for (const endpoint of configuration.endpoints) {
    const data = {
      enabled: endpoint.enabled,
      label: endpoint.label,
      locationId: endpoint.locationId,
      providerCredentialId: endpoint.providerCredentialId,
      sipUsername: endpoint.sipUsername,
      userId: endpoint.userId,
    };
    await transaction.callCenterEndpoint.upsert({
      create: { ...data, id: endpoint.id, practiceId: configuration.practiceId },
      update: data,
      where: { id: endpoint.id },
    });
  }

  for (const queue of configuration.queues) {
    if (!queue.overflowQueueId) continue;
    await transaction.callCenterQueue.update({
      data: { overflowQueueId: queue.overflowQueueId },
      where: { id: queue.id },
    });
  }

  await transaction.practiceCallCenterSettings.upsert({
    create: {
      defaultOutboundNumberId: configuration.defaultOutboundNumberId,
      practiceId: configuration.practiceId,
    },
    update: {
      defaultOutboundNumberId: configuration.defaultOutboundNumberId,
    },
    where: { practiceId: configuration.practiceId },
  });

  const nextVersion = callCenterConfigurationVersion(configuration);
  await transaction.callCenterEvent.create({
    data: {
      actorUserId: audit.actorUserId,
      aggregateId: configuration.practiceId,
      aggregateType: "CONFIGURATION",
      data: {
        counts: {
          endpoints: configuration.endpoints.length,
          memberships: configuration.queues.reduce(
            (count, queue) => count + queue.members.length,
            0,
          ),
          numbers: configuration.numbers.length,
          queues: configuration.queues.length,
        },
        fromVersion: audit.previousVersion,
        toVersion: nextVersion,
      },
      practiceId: configuration.practiceId,
      type: "CONFIGURATION_UPDATED",
    },
  });
}

export class PrismaCallCenterConfigurationRepository implements CallCenterConfigurationRepository {
  constructor(
    private readonly runTransaction: ConfigurationTransactionRunner = runPrismaTransaction,
  ) {}

  transaction<T>(
    operation: (transaction: CallCenterConfigurationTransaction) => Promise<T>,
  ) {
    return this.runTransaction((transaction) =>
      operation(createPrismaConfigurationTransaction(transaction)),
    );
  }
}

export function createPrismaConfigurationTransaction(
  transaction: ConfigurationPrismaTransaction,
): CallCenterConfigurationTransaction {
  return {
    loadValidationContextForUpdate: (practiceId, references) =>
      loadConfigurationValidationContext(transaction, practiceId, references),
    persistValidatedSnapshot: (configuration, audit) =>
      persistConfigurationSnapshot(transaction, configuration, audit),
  };
}

export async function readCallCenterConfiguration(
  practiceId: string,
  client: ConfigurationReadClient = prisma,
): Promise<VersionedCallCenterConfiguration | null> {
  const practice = await client.practice.findUnique({
    select: {
      id: true,
      callCenterSettings: {
        select: { defaultOutboundNumberId: true },
      },
      callCenterQueues: {
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          enabled: true,
          ringTimeoutSec: true,
          maxWaitSec: true,
          wrapUpSec: true,
          voicemailEnabled: true,
          voicemailGreeting: true,
          overflowQueueId: true,
          locations: {
            orderBy: { locationId: "asc" },
            select: { locationId: true },
          },
          members: {
            orderBy: { userId: "asc" },
            select: { userId: true, role: true, enabled: true },
          },
        },
      },
      callCenterNumbers: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          practicePhoneNumberId: true,
          providerNumberId: true,
          inboundQueueId: true,
          inboundEnabled: true,
          outboundEnabled: true,
          enabled: true,
        },
      },
      callCenterEndpoints: {
        orderBy: [{ label: "asc" }, { id: "asc" }],
        select: {
          id: true,
          locationId: true,
          label: true,
          providerCredentialId: true,
          sipUsername: true,
          userId: true,
          enabled: true,
        },
      },
    },
    where: { id: practiceId },
  });

  if (!practice) return null;
  const configuration: ValidatedCallCenterConfiguration = {
    practiceId: practice.id,
    defaultOutboundNumberId: practice.callCenterSettings?.defaultOutboundNumberId ?? null,
    queues: practice.callCenterQueues.map(({ locations, ...queue }) => ({
      ...queue,
      locationIds: locations.map(({ locationId }) => locationId),
    })),
    numbers: practice.callCenterNumbers,
    endpoints: practice.callCenterEndpoints,
  };
  return {
    configuration,
    version: callCenterConfigurationVersion(configuration),
  };
}
