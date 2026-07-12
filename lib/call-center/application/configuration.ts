import { createHash } from "node:crypto";

import { isValidQueuePolicy } from "@/lib/call-center/domain/queue-policy";

export type CallCenterRoutingMode = "LEGACY" | "SHADOW" | "ACTIVE";
export type CallCenterQueueRole = "AGENT" | "SUPERVISOR";

export type CallCenterConfigurationInput = {
  practiceId: string;
  defaultOutboundNumberId: string | null;
  queues: Array<{
    id: string;
    name: string;
    enabled: boolean;
    routingMode: CallCenterRoutingMode;
    ringTimeoutSec: number;
    maxWaitSec: number;
    wrapUpSec: number;
    voicemailEnabled: boolean;
    voicemailGreeting: string;
    overflowQueueId: string | null;
    locationIds: string[];
    members: Array<{
      userId: string;
      role: CallCenterQueueRole;
      enabled: boolean;
    }>;
  }>;
  numbers: Array<{
    id: string;
    practicePhoneNumberId: string;
    providerNumberId: string | null;
    inboundQueueId: string | null;
    inboundEnabled: boolean;
    outboundEnabled: boolean;
    enabled: boolean;
  }>;
  endpoints: Array<{
    id: string;
    locationId: string | null;
    label: string;
    providerCredentialId: string | null;
    sipUsername: string | null;
    enabled: boolean;
  }>;
};

export type ValidatedCallCenterConfiguration = CallCenterConfigurationInput;

export type SavedCallCenterConfiguration = {
  changed: boolean;
  configuration: ValidatedCallCenterConfiguration;
  version: string;
};

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => [key, canonicalJson(nested)]),
  );
}

export function callCenterConfigurationVersion(
  configuration: ValidatedCallCenterConfiguration,
) {
  const canonical = {
    ...configuration,
    queues: configuration.queues
      .map((queue) => ({
        ...queue,
        locationIds: [...queue.locationIds].sort(),
        members: [...queue.members].sort((left, right) =>
          compareCodeUnits(left.userId, right.userId),
        ),
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    numbers: [...configuration.numbers].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    ),
    endpoints: [...configuration.endpoints].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    ),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(canonical)))
    .digest("hex");
}

export type CallCenterConfigurationAudit = {
  actorUserId: string | null;
  automation?: {
    actor: string;
    triggeringActor: string;
    runId: string;
    runAttempt: number;
  };
  previousVersion: string;
  source?: "ADMIN_API" | "LEGACY_BOOTSTRAP";
};

export type CallCenterConfigurationReferences = {
  queueIds: string[];
  numberIds: string[];
  endpointIds: string[];
  locationIds: string[];
  practicePhoneNumberIds: string[];
  providerNumberIds: string[];
  memberUserIds: string[];
  providerCredentialIds: string[];
  sipUsernames: string[];
};

export type CallCenterConfigurationValidationContext = {
  practiceExists: boolean;
  configurationVersion: string;
  ownedLocationIds: ReadonlySet<string>;
  ownedPracticePhoneNumberIds: ReadonlySet<string>;
  practicePhoneNumberLocationIds: ReadonlyMap<string, string | null>;
  practiceMemberUserIds: ReadonlySet<string>;
  queueOwnerPracticeIds: ReadonlyMap<string, string>;
  numberOwnerPracticeIds: ReadonlyMap<string, string>;
  endpointOwnerPracticeIds: ReadonlyMap<string, string>;
  providerCredentialEndpointIds: ReadonlyMap<string, string>;
  providerNumberOwnerNumberIds: ReadonlyMap<string, string>;
  sipUsernameEndpointIds: ReadonlyMap<string, string>;
  enabledQueueIds: ReadonlySet<string>;
  enabledNumberIds: ReadonlySet<string>;
  enabledEndpointIds: ReadonlySet<string>;
  enabledMembershipKeys: ReadonlySet<string>;
  currentConfiguration: ValidatedCallCenterConfiguration | null;
};

export type CallCenterConfigurationIssueCode =
  | "PRACTICE_NOT_FOUND"
  | "REQUIRED_FIELD"
  | "DUPLICATE_VALUE"
  | "CROSS_PRACTICE_ENTITY"
  | "UNKNOWN_LOCATION"
  | "UNKNOWN_PHONE_NUMBER"
  | "UNKNOWN_QUEUE"
  | "MEMBERSHIP_REQUIRED"
  | "INVALID_QUEUE_POLICY"
  | "INBOUND_NUMBER_LOCATION_MISMATCH"
  | "OVERFLOW_QUEUE_CYCLE"
  | "DISABLED_OVERFLOW_QUEUE"
  | "INVALID_INBOUND_ROUTE"
  | "INVALID_OUTBOUND_NUMBER"
  | "ENDPOINT_CREDENTIALS_REQUIRED"
  | "ENDPOINT_IDENTITY_ALREADY_ASSIGNED"
  | "PROVIDER_NUMBER_ALREADY_ASSIGNED"
  | "INCOMPLETE_ROUTING"
  | "INVALID_VALUE"
  | "STALE_CONFIGURATION"
  | "ACTIVE_NOT_AVAILABLE"
  | "OMITTED_ENABLED_ENTITY"
  | "OMITTED_ENABLED_MEMBERSHIP"
  | "VOICEMAIL_GREETING_REQUIRED";

export type CallCenterConfigurationIssue = {
  code: CallCenterConfigurationIssueCode;
  path: string;
  message: string;
};

export class CallCenterConfigurationError extends Error {
  readonly issues: CallCenterConfigurationIssue[];

  constructor(issues: CallCenterConfigurationIssue[]) {
    super("Call-center configuration is invalid");
    this.name = "CallCenterConfigurationError";
    this.issues = issues;
  }
}

export interface CallCenterConfigurationTransaction {
  /**
   * Loads and locks the practice boundary. Owner maps must include every
   * existing referenced configuration ID, including IDs owned by other practices.
   */
  loadValidationContextForUpdate(
    practiceId: string,
    references: CallCenterConfigurationReferences,
  ): Promise<CallCenterConfigurationValidationContext>;
  /** Reconciles the complete validated snapshot. No partial writes are allowed. */
  persistValidatedSnapshot(
    configuration: ValidatedCallCenterConfiguration,
    audit: CallCenterConfigurationAudit,
  ): Promise<void>;
}

export interface CallCenterConfigurationRepository {
  transaction<T>(
    operation: (transaction: CallCenterConfigurationTransaction) => Promise<T>,
  ): Promise<T>;
}

function clean(value: string) {
  return value.trim();
}

function cleanOptional(value: string | null) {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function normalizeConfiguration(
  input: CallCenterConfigurationInput,
): ValidatedCallCenterConfiguration {
  return {
    practiceId: clean(input.practiceId),
    defaultOutboundNumberId: cleanOptional(input.defaultOutboundNumberId),
    queues: input.queues.map((queue) => ({
      ...queue,
      id: clean(queue.id),
      name: clean(queue.name),
      voicemailGreeting: clean(queue.voicemailGreeting),
      overflowQueueId: cleanOptional(queue.overflowQueueId),
      locationIds: queue.locationIds.map(clean),
      members: queue.members.map((member) => ({
        ...member,
        userId: clean(member.userId),
      })),
    })),
    numbers: input.numbers.map((number) => ({
      ...number,
      id: clean(number.id),
      practicePhoneNumberId: clean(number.practicePhoneNumberId),
      providerNumberId: cleanOptional(number.providerNumberId),
      inboundQueueId: cleanOptional(number.inboundQueueId),
    })),
    endpoints: input.endpoints.map((endpoint) => ({
      ...endpoint,
      id: clean(endpoint.id),
      locationId: cleanOptional(endpoint.locationId),
      label: clean(endpoint.label),
      providerCredentialId: cleanOptional(endpoint.providerCredentialId),
      sipUsername: cleanOptional(endpoint.sipUsername),
    })),
  };
}

function sorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort();
}

export function collectCallCenterConfigurationReferences(
  input: CallCenterConfigurationInput,
): CallCenterConfigurationReferences {
  const configuration = normalizeConfiguration(input);
  return {
    queueIds: sorted(configuration.queues.map(({ id }) => id)),
    numberIds: sorted(configuration.numbers.map(({ id }) => id)),
    endpointIds: sorted(configuration.endpoints.map(({ id }) => id)),
    locationIds: sorted(
      configuration.queues
        .flatMap(({ locationIds }) => locationIds)
        .concat(
          configuration.endpoints.flatMap(({ locationId }) =>
            locationId ? [locationId] : [],
          ),
        ),
    ),
    practicePhoneNumberIds: sorted(
      configuration.numbers.map(({ practicePhoneNumberId }) => practicePhoneNumberId),
    ),
    providerNumberIds: sorted(
      configuration.numbers.flatMap(({ providerNumberId }) =>
        providerNumberId ? [providerNumberId] : [],
      ),
    ),
    memberUserIds: sorted(
      configuration.queues.flatMap(({ members }) => members.map(({ userId }) => userId)),
    ),
    providerCredentialIds: sorted(
      configuration.endpoints.flatMap(({ providerCredentialId }) =>
        providerCredentialId ? [providerCredentialId] : [],
      ),
    ),
    sipUsernames: sorted(
      configuration.endpoints.flatMap(({ sipUsername }) =>
        sipUsername ? [sipUsername] : [],
      ),
    ),
  };
}

function addDuplicateIssues<T>(
  items: T[],
  value: (item: T) => string,
  path: (index: number) => string,
  issues: CallCenterConfigurationIssue[],
) {
  const firstIndex = new Map<string, number>();
  items.forEach((item, index) => {
    const key = value(item);
    if (!key) return;
    if (firstIndex.has(key)) {
      issues.push({
        code: "DUPLICATE_VALUE",
        path: path(index),
        message: `Duplicates ${path(firstIndex.get(key)!)}`,
      });
    } else {
      firstIndex.set(key, index);
    }
  });
}

function requireText(
  value: string,
  path: string,
  issues: CallCenterConfigurationIssue[],
) {
  if (!value) {
    issues.push({ code: "REQUIRED_FIELD", path, message: "Required" });
  }
}

function rejectCrossPracticeOwner(
  ownerPracticeId: string | undefined,
  practiceId: string,
  path: string,
  issues: CallCenterConfigurationIssue[],
) {
  if (ownerPracticeId && ownerPracticeId !== practiceId) {
    issues.push({
      code: "CROSS_PRACTICE_ENTITY",
      path,
      message: "Entity belongs to another practice",
    });
  }
}

function hasOverflowCycle(
  startQueueId: string,
  overflowByQueueId: ReadonlyMap<string, string | null>,
) {
  const visited = new Set<string>();
  let queueId: string | null | undefined = startQueueId;
  while (queueId) {
    if (visited.has(queueId)) return true;
    visited.add(queueId);
    queueId = overflowByQueueId.get(queueId);
  }
  return false;
}

function rejectOmittedEnabledEntities(
  kind: "queues" | "numbers" | "endpoints",
  submittedIds: ReadonlySet<string>,
  enabledIds: ReadonlySet<string>,
  issues: CallCenterConfigurationIssue[],
) {
  for (const id of enabledIds ?? []) {
    if (!submittedIds.has(id)) {
      issues.push({
        code: "OMITTED_ENABLED_ENTITY",
        path: kind,
        message: `Enabled ${kind.slice(0, -1)} ${id} must be included or explicitly disabled`,
      });
    }
  }
}

function preserveOmittedDisabledEntities(
  input: CallCenterConfigurationInput,
  current: ValidatedCallCenterConfiguration | null,
): CallCenterConfigurationInput {
  if (!current) return input;
  const preserve = <T extends { id: string; enabled: boolean }>(
    submitted: T[],
    existing: T[],
  ) => {
    const submittedIds = new Set(submitted.map(({ id }) => id.trim()));
    return submitted.concat(
      existing.filter(({ id, enabled }) => !enabled && !submittedIds.has(id)),
    );
  };
  return {
    ...input,
    queues: preserve(
      input.queues.map((queue) => {
        const existing = current.queues.find(({ id }) => id === queue.id.trim());
        if (!existing) return queue;
        const submittedUserIds = new Set(
          queue.members.map(({ userId }) => userId.trim()),
        );
        return {
          ...queue,
          members: queue.members.concat(
            existing.members.filter(
              ({ enabled, userId }) => !enabled && !submittedUserIds.has(userId),
            ),
          ),
        };
      }),
      current.queues,
    ),
    numbers: preserve(input.numbers, current.numbers),
    endpoints: preserve(input.endpoints, current.endpoints),
  };
}

export function callCenterMembershipKey(queueId: string, userId: string) {
  return `${queueId}\u0000${userId}`;
}

export function validateCallCenterConfiguration(
  input: CallCenterConfigurationInput,
  context: CallCenterConfigurationValidationContext,
): ValidatedCallCenterConfiguration {
  const configuration = normalizeConfiguration(input);
  const issues: CallCenterConfigurationIssue[] = [];

  requireText(configuration.practiceId, "practiceId", issues);
  if (!context.practiceExists) {
    issues.push({
      code: "PRACTICE_NOT_FOUND",
      path: "practiceId",
      message: "Practice does not exist",
    });
  }

  addDuplicateIssues(
    configuration.queues,
    ({ id }) => id,
    (index) => `queues[${index}].id`,
    issues,
  );
  addDuplicateIssues(
    configuration.queues,
    ({ name }) => name.toLowerCase(),
    (index) => `queues[${index}].name`,
    issues,
  );
  addDuplicateIssues(
    configuration.numbers,
    ({ id }) => id,
    (index) => `numbers[${index}].id`,
    issues,
  );
  addDuplicateIssues(
    configuration.numbers,
    ({ practicePhoneNumberId }) => practicePhoneNumberId,
    (index) => `numbers[${index}].practicePhoneNumberId`,
    issues,
  );
  addDuplicateIssues(
    configuration.numbers,
    ({ providerNumberId }) => providerNumberId ?? "",
    (index) => `numbers[${index}].providerNumberId`,
    issues,
  );
  addDuplicateIssues(
    configuration.endpoints,
    ({ id }) => id,
    (index) => `endpoints[${index}].id`,
    issues,
  );
  addDuplicateIssues(
    configuration.endpoints,
    ({ label }) => label.toLowerCase(),
    (index) => `endpoints[${index}].label`,
    issues,
  );
  addDuplicateIssues(
    configuration.endpoints,
    ({ providerCredentialId }) => providerCredentialId ?? "",
    (index) => `endpoints[${index}].providerCredentialId`,
    issues,
  );
  addDuplicateIssues(
    configuration.endpoints,
    ({ sipUsername }) => sipUsername ?? "",
    (index) => `endpoints[${index}].sipUsername`,
    issues,
  );

  const queuesById = new Map(
    configuration.queues.map((queue) => [queue.id, queue] as const),
  );
  const overflowByQueueId = new Map(
    configuration.queues.map(({ id, overflowQueueId }) => [id, overflowQueueId] as const),
  );
  rejectOmittedEnabledEntities(
    "queues",
    new Set(configuration.queues.map(({ id }) => id)),
    context.enabledQueueIds,
    issues,
  );
  const submittedMembershipKeys = new Set(
    configuration.queues.flatMap((queue) =>
      queue.members.map(({ userId }) => callCenterMembershipKey(queue.id, userId)),
    ),
  );
  for (const membershipKey of context.enabledMembershipKeys) {
    if (!submittedMembershipKeys.has(membershipKey)) {
      issues.push({
        code: "OMITTED_ENABLED_MEMBERSHIP",
        path: "queues",
        message: "Enabled queue memberships must be explicitly disabled before omission",
      });
    }
  }
  rejectOmittedEnabledEntities(
    "numbers",
    new Set(configuration.numbers.map(({ id }) => id)),
    context.enabledNumberIds,
    issues,
  );
  rejectOmittedEnabledEntities(
    "endpoints",
    new Set(configuration.endpoints.map(({ id }) => id)),
    context.enabledEndpointIds,
    issues,
  );
  const validRoutingModes = new Set<CallCenterRoutingMode>([
    "LEGACY",
    "SHADOW",
    "ACTIVE",
  ]);
  const validQueueRoles = new Set<CallCenterQueueRole>(["AGENT", "SUPERVISOR"]);

  for (const [queueIndex, queue] of configuration.queues.entries()) {
    const path = `queues[${queueIndex}]`;
    requireText(queue.id, `${path}.id`, issues);
    requireText(queue.name, `${path}.name`, issues);
    if (!validRoutingModes.has(queue.routingMode)) {
      issues.push({
        code: "INVALID_VALUE",
        path: `${path}.routingMode`,
        message: "Unknown routing mode",
      });
    }
    if (queue.routingMode === "ACTIVE") {
      issues.push({
        code: "ACTIVE_NOT_AVAILABLE",
        path: `${path}.routingMode`,
        message: "Active routing is unavailable until execution cutover",
      });
    }
    rejectCrossPracticeOwner(
      context.queueOwnerPracticeIds.get(queue.id),
      configuration.practiceId,
      `${path}.id`,
      issues,
    );
    if (!isValidQueuePolicy(queue)) {
      issues.push({
        code: "INVALID_QUEUE_POLICY",
        path,
        message: "Queue timeouts are outside the supported bounds",
      });
    }
    if (queue.voicemailEnabled && !queue.voicemailGreeting) {
      issues.push({
        code: "VOICEMAIL_GREETING_REQUIRED",
        path: `${path}.voicemailGreeting`,
        message: "Enabled voicemail requires a greeting",
      });
    }
    if (queue.overflowQueueId) {
      const overflow = queuesById.get(queue.overflowQueueId);
      if (!overflow) {
        issues.push({
          code: "UNKNOWN_QUEUE",
          path: `${path}.overflowQueueId`,
          message: "Overflow queue is not in this practice configuration",
        });
      } else if (queue.enabled && !overflow.enabled) {
        issues.push({
          code: "DISABLED_OVERFLOW_QUEUE",
          path: `${path}.overflowQueueId`,
          message: "An enabled queue cannot overflow to a disabled queue",
        });
      }
    }

    addDuplicateIssues(
      queue.locationIds,
      (locationId) => locationId,
      (index) => `${path}.locationIds[${index}]`,
      issues,
    );
    queue.locationIds.forEach((locationId, locationIndex) => {
      requireText(locationId, `${path}.locationIds[${locationIndex}]`, issues);
      if (locationId && !context.ownedLocationIds.has(locationId)) {
        issues.push({
          code: "UNKNOWN_LOCATION",
          path: `${path}.locationIds[${locationIndex}]`,
          message: "Location does not belong to this practice",
        });
      }
    });

    addDuplicateIssues(
      queue.members,
      ({ userId }) => userId,
      (index) => `${path}.members[${index}].userId`,
      issues,
    );
    queue.members.forEach((member, memberIndex) => {
      requireText(member.userId, `${path}.members[${memberIndex}].userId`, issues);
      if (!validQueueRoles.has(member.role)) {
        issues.push({
          code: "INVALID_VALUE",
          path: `${path}.members[${memberIndex}].role`,
          message: "Unknown queue member role",
        });
      }
      if (member.userId && !context.practiceMemberUserIds.has(member.userId)) {
        issues.push({
          code: "MEMBERSHIP_REQUIRED",
          path: `${path}.members[${memberIndex}].userId`,
          message: "User is not a member of this practice",
        });
      }
    });
  }

  for (const queue of configuration.queues) {
    if (hasOverflowCycle(queue.id, overflowByQueueId)) {
      issues.push({
        code: "OVERFLOW_QUEUE_CYCLE",
        path: "queues",
        message: "Queue overflow configuration contains a cycle",
      });
      break;
    }
  }

  for (const [numberIndex, number] of configuration.numbers.entries()) {
    const path = `numbers[${numberIndex}]`;
    requireText(number.id, `${path}.id`, issues);
    requireText(number.practicePhoneNumberId, `${path}.practicePhoneNumberId`, issues);
    rejectCrossPracticeOwner(
      context.numberOwnerPracticeIds.get(number.id),
      configuration.practiceId,
      `${path}.id`,
      issues,
    );
    if (
      number.practicePhoneNumberId &&
      !context.ownedPracticePhoneNumberIds.has(number.practicePhoneNumberId)
    ) {
      issues.push({
        code: "UNKNOWN_PHONE_NUMBER",
        path: `${path}.practicePhoneNumberId`,
        message: "Phone number does not belong to this practice",
      });
    }
    if (
      number.providerNumberId &&
      context.providerNumberOwnerNumberIds.get(number.providerNumberId) !== undefined &&
      context.providerNumberOwnerNumberIds.get(number.providerNumberId) !== number.id
    ) {
      issues.push({
        code: "PROVIDER_NUMBER_ALREADY_ASSIGNED",
        path: `${path}.providerNumberId`,
        message: "Provider number is assigned to another call-center number",
      });
    }
    const inboundQueue = number.inboundQueueId
      ? queuesById.get(number.inboundQueueId)
      : null;
    if (number.inboundQueueId && !inboundQueue) {
      issues.push({
        code: "UNKNOWN_QUEUE",
        path: `${path}.inboundQueueId`,
        message: "Inbound queue is not in this practice configuration",
      });
    }
    if (number.inboundEnabled && (!number.enabled || !inboundQueue?.enabled)) {
      issues.push({
        code: "INVALID_INBOUND_ROUTE",
        path,
        message: "Inbound calling requires an enabled number and queue",
      });
    }
    if (
      number.enabled &&
      number.inboundEnabled &&
      inboundQueue &&
      context.ownedPracticePhoneNumberIds.has(number.practicePhoneNumberId)
    ) {
      const phoneLocationId = context.practicePhoneNumberLocationIds.get(
        number.practicePhoneNumberId,
      );
      if (!phoneLocationId || !inboundQueue.locationIds.includes(phoneLocationId)) {
        issues.push({
          code: "INBOUND_NUMBER_LOCATION_MISMATCH",
          path: `${path}.inboundQueueId`,
          message: "Inbound phone number location must belong to its queue",
        });
      }
    }
    if (number.outboundEnabled && !number.enabled) {
      issues.push({
        code: "INVALID_OUTBOUND_NUMBER",
        path,
        message: "Outbound calling requires an enabled number",
      });
    }
  }

  for (const [endpointIndex, endpoint] of configuration.endpoints.entries()) {
    const path = `endpoints[${endpointIndex}]`;
    requireText(endpoint.id, `${path}.id`, issues);
    requireText(endpoint.label, `${path}.label`, issues);
    rejectCrossPracticeOwner(
      context.endpointOwnerPracticeIds.get(endpoint.id),
      configuration.practiceId,
      `${path}.id`,
      issues,
    );
    if (endpoint.locationId && !context.ownedLocationIds.has(endpoint.locationId)) {
      issues.push({
        code: "UNKNOWN_LOCATION",
        path: `${path}.locationId`,
        message: "Endpoint location does not belong to this practice",
      });
    }
    if (endpoint.enabled && (!endpoint.providerCredentialId || !endpoint.sipUsername)) {
      issues.push({
        code: "ENDPOINT_CREDENTIALS_REQUIRED",
        path,
        message: "Enabled endpoints require provider and SIP credentials",
      });
    }
    if (
      endpoint.providerCredentialId &&
      context.providerCredentialEndpointIds.get(endpoint.providerCredentialId) !==
        undefined &&
      context.providerCredentialEndpointIds.get(endpoint.providerCredentialId) !==
        endpoint.id
    ) {
      issues.push({
        code: "ENDPOINT_IDENTITY_ALREADY_ASSIGNED",
        path: `${path}.providerCredentialId`,
        message: "Provider credential is assigned to another endpoint",
      });
    }
    if (
      endpoint.sipUsername &&
      context.sipUsernameEndpointIds.get(endpoint.sipUsername) !== undefined &&
      context.sipUsernameEndpointIds.get(endpoint.sipUsername) !== endpoint.id
    ) {
      issues.push({
        code: "ENDPOINT_IDENTITY_ALREADY_ASSIGNED",
        path: `${path}.sipUsername`,
        message: "SIP username is assigned to another endpoint",
      });
    }
  }

  for (const [queueIndex, queue] of configuration.queues.entries()) {
    if (!queue.enabled || queue.routingMode === "LEGACY") continue;

    const path = `queues[${queueIndex}]`;
    const hasInboundNumber = configuration.numbers.some(
      (number) =>
        number.enabled && number.inboundEnabled && number.inboundQueueId === queue.id,
    );
    const hasAgent = queue.members.some(
      (member) => member.enabled && member.role === "AGENT",
    );
    const queueLocations = new Set(queue.locationIds);
    const hasEndpoint = configuration.endpoints.some(
      (endpoint) =>
        endpoint.enabled &&
        Boolean(endpoint.providerCredentialId && endpoint.sipUsername) &&
        (endpoint.locationId === null || queueLocations.has(endpoint.locationId)),
    );

    if (!queue.locationIds.length) {
      issues.push({
        code: "INCOMPLETE_ROUTING",
        path: `${path}.locationIds`,
        message: "Shadow and active queues require at least one location",
      });
    }
    if (!hasInboundNumber) {
      issues.push({
        code: "INCOMPLETE_ROUTING",
        path,
        message: "Shadow and active queues require an enabled inbound number",
      });
    }
    if (!hasAgent) {
      issues.push({
        code: "INCOMPLETE_ROUTING",
        path: `${path}.members`,
        message: "Shadow and active queues require an enabled agent",
      });
    }
    if (!hasEndpoint) {
      issues.push({
        code: "INCOMPLETE_ROUTING",
        path: "endpoints",
        message: "Shadow and active queues require a configured endpoint",
      });
    }
  }

  if (configuration.defaultOutboundNumberId) {
    const defaultNumber = configuration.numbers.find(
      ({ id }) => id === configuration.defaultOutboundNumberId,
    );
    if (!defaultNumber?.enabled || !defaultNumber.outboundEnabled) {
      issues.push({
        code: "INVALID_OUTBOUND_NUMBER",
        path: "defaultOutboundNumberId",
        message: "Default outbound number must be enabled for outbound calling",
      });
    }
  }

  if (issues.length) {
    throw new CallCenterConfigurationError(issues);
  }
  return configuration;
}

export async function saveCallCenterConfiguration(
  repository: CallCenterConfigurationRepository,
  input: CallCenterConfigurationInput,
  expectedVersion: string,
  actorUserId: string,
) {
  return repository.transaction((transaction) =>
    saveCallCenterConfigurationInTransaction(
      transaction,
      input,
      expectedVersion,
      actorUserId,
    ),
  );
}

export async function saveCallCenterConfigurationInTransaction(
  transaction: CallCenterConfigurationTransaction,
  input: CallCenterConfigurationInput,
  expectedVersion: string,
  actorUserId: string | null,
  auditMetadata: Pick<CallCenterConfigurationAudit, "automation" | "source"> = {},
) {
  const references = collectCallCenterConfigurationReferences(input);
  const practiceId = clean(input.practiceId);
  const context = await transaction.loadValidationContextForUpdate(
    practiceId,
    references,
  );
  if (context.practiceExists && context.configurationVersion !== expectedVersion) {
    throw new CallCenterConfigurationError([
      {
        code: "STALE_CONFIGURATION",
        path: "",
        message: "Configuration changed after it was loaded",
      },
    ]);
  }
  const configuration = validateCallCenterConfiguration(
    preserveOmittedDisabledEntities(input, context.currentConfiguration),
    context,
  );
  const version = callCenterConfigurationVersion(configuration);
  if (version === context.configurationVersion) {
    return { changed: false, configuration, version };
  }
  await transaction.persistValidatedSnapshot(configuration, {
    actorUserId,
    ...auditMetadata,
    previousVersion: context.configurationVersion,
  });
  return { changed: true, configuration, version };
}
