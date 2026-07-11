import { createHash } from "node:crypto";

import { phoneNationalDigits } from "@/lib/phone";

const LEGACY_AGENT_RING_TIMEOUT_SEC = 20;
const LEGACY_DEFAULT_WAIT_TIMEOUT_SEC = 30;
const LEGACY_MAX_WAIT_TIMEOUT_SEC = 120;

export type LegacyCallCenterBackfillSnapshot = {
  practiceId: string;
  locationIds: string[];
  existingGenericConfiguration: {
    endpointCount: number;
    numberCount: number;
    queueCount: number;
  };
  settings: {
    enabled: boolean;
    inboundPhoneNumber: string | null;
    outboundCallerNumber: string | null;
    recordingEnabled: boolean;
    telnyxConnectionId: string | null;
    telnyxCredentialId: string | null;
    voicemailGreeting: string;
    voicemailTimeoutSec: number;
  } | null;
  phoneNumbers: Array<{
    id: string;
    locationId: string | null;
    phoneNumber: string;
  }>;
  seats: Array<{
    id: string;
    enabled: boolean;
    locationId: string | null;
    observedUserIds: string[];
    queueKey: string | null;
    providerCredentialId: string | null;
    sipUsername: string | null;
  }>;
  profileAssignments: Array<{
    locationIds: string[];
    queueKey: string;
    userId: string;
  }>;
  runtimeFallbacks: {
    connection: boolean;
    credential: boolean;
    inboundNumber: boolean;
    outboundNumber: boolean;
  };
};

export type LegacyBackfillAmbiguityCode =
  | "ENDPOINT_IDENTITY_DUPLICATE"
  | "ENDPOINT_IDENTITY_INCOMPLETE"
  | "GENERIC_CONFIGURATION_PRESENT"
  | "INBOUND_NUMBER_MATCH_AMBIGUOUS"
  | "INBOUND_NUMBER_NOT_CONFIGURED"
  | "INBOUND_NUMBER_NOT_FOUND"
  | "INBOUND_QUEUE_MATCH_AMBIGUOUS"
  | "INBOUND_QUEUE_NOT_FOUND"
  | "LEGACY_SETTINGS_MISSING"
  | "LOCATION_REFERENCE_OUTSIDE_PRACTICE"
  | "NO_LEGACY_SEATS"
  | "OUTBOUND_NUMBER_MATCH_AMBIGUOUS"
  | "OUTBOUND_NUMBER_NOT_CONFIGURED"
  | "OUTBOUND_NUMBER_NOT_FOUND"
  | "PROFILE_QUEUE_WITHOUT_SEAT"
  | "QUEUE_LOCATION_MISSING"
  | "QUEUE_MEMBER_MISSING"
  | "QUEUE_WITHOUT_READY_ENDPOINT"
  | "SEAT_SCOPE_MISSING"
  | "VOICEMAIL_GREETING_MISSING";

export type LegacyCallCenterBackfillReport = {
  kind: "LEGACY_CALL_CENTER_BACKFILL_REPORT";
  mode: "REPORT_ONLY";
  practiceId: string;
  writeSupported: false;
  overallReadiness: "BLOCKED" | "READY_FOR_MANUAL_REVIEW";
  settings: {
    detected: boolean;
    enabled: boolean;
    recordingEnabled: boolean | null;
    voicemailGreetingConfigured: boolean;
    effectiveMaxWaitSec: number | null;
    databaseConnectionConfigured: boolean;
    databaseCredentialConfigured: boolean;
    runtimeFallbacks: LegacyCallCenterBackfillSnapshot["runtimeFallbacks"];
  };
  queues: Array<{
    proposedId: string;
    proposedName: string;
    source: "EXPLICIT_QUEUE_KEY" | "LOCATION_SCOPE";
    enabled: boolean;
    routingMode: "LEGACY";
    nextModeAfterReview: "SHADOW" | null;
    locationIds: string[];
    memberUserIds: string[];
    sourceSeatIds: string[];
    endpointIds: string[];
    ringTimeoutSec: number | null;
    maxWaitSec: number | null;
    wrapUpSec: 0;
    voicemailEnabled: boolean;
    voicemailGreetingConfigured: boolean;
    shadowReadiness: "BLOCKED" | "READY_FOR_REVIEW";
  }>;
  numbers: Array<{
    proposedId: string;
    practicePhoneNumberId: string;
    enabled: boolean;
    inboundEnabled: boolean;
    inboundQueueId: string | null;
    outboundEnabled: boolean;
    providerNumberIdConfigured: false;
  }>;
  endpoints: Array<{
    proposedId: string;
    proposedLabel: string;
    sourceSeatId: string;
    queueId: string | null;
    locationId: string | null;
    enabled: boolean;
    providerCredentialConfigured: boolean;
    sipUsernameConfigured: boolean;
    identityStatus: "CONFIGURED" | "DUPLICATE" | "INCOMPLETE";
  }>;
  defaultOutboundNumberId: string | null;
  ambiguities: Array<{
    code: LegacyBackfillAmbiguityCode;
    count: number;
    affectedRefs: string[];
  }>;
  summary: {
    ambiguityCategoryCount: number;
    ambiguityOccurrenceCount: number;
    endpointCount: number;
    existingGenericEndpointCount: number;
    existingGenericNumberCount: number;
    existingGenericQueueCount: number;
    numberCount: number;
    queueCount: number;
    shadowReadyQueueCount: number;
  };
};

type QueueSource = {
  kind: "EXPLICIT_QUEUE_KEY" | "LOCATION_SCOPE";
  value: string;
};

type MutableQueue = QueueSource & {
  proposedId: string;
  locationIds: Set<string>;
  memberUserIds: Set<string>;
  sourceSeatIds: Set<string>;
  endpointIds: Set<string>;
};

function opaqueId(prefix: "ccn" | "ccq", ...parts: string[]) {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${prefix}_${digest.slice(0, 24)}`;
}

function cleanOptional(value: string | null | undefined) {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function queueSourceForSeat(
  seat: LegacyCallCenterBackfillSnapshot["seats"][number],
): QueueSource | null {
  if (seat.queueKey?.trim()) {
    // Preserve exact legacy equality semantics. The raw key is used only in
    // process for matching and is never returned by the report.
    return { kind: "EXPLICIT_QUEUE_KEY", value: seat.queueKey };
  }
  if (seat.locationId) {
    return { kind: "LOCATION_SCOPE", value: seat.locationId };
  }
  return null;
}

function queueMapKey(source: QueueSource) {
  return `${source.kind}\u0000${source.value}`;
}

function effectiveLegacyMaxWait(timeoutSec: number) {
  const requested = Number.isFinite(timeoutSec)
    ? Math.round(timeoutSec || LEGACY_DEFAULT_WAIT_TIMEOUT_SEC)
    : LEGACY_DEFAULT_WAIT_TIMEOUT_SEC;
  return Math.min(LEGACY_MAX_WAIT_TIMEOUT_SEC, Math.max(1, requested));
}

function phoneMatches(
  configuredPhone: string | null,
  phoneNumbers: LegacyCallCenterBackfillSnapshot["phoneNumbers"],
) {
  const configuredDigits = phoneNationalDigits(configuredPhone);
  if (!configuredDigits) return [];
  return phoneNumbers.filter(
    ({ phoneNumber }) => phoneNationalDigits(phoneNumber) === configuredDigits,
  );
}

function identityCounts(values: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const cleaned = cleanOptional(value);
    if (cleaned) counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  return counts;
}

function sorted(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

export function buildLegacyCallCenterBackfillReport(
  snapshot: LegacyCallCenterBackfillSnapshot,
): LegacyCallCenterBackfillReport {
  const ambiguities = new Map<LegacyBackfillAmbiguityCode, Set<string>>();
  const addAmbiguity = (code: LegacyBackfillAmbiguityCode, reference: string) => {
    const references = ambiguities.get(code) ?? new Set<string>();
    references.add(reference);
    ambiguities.set(code, references);
  };
  const practiceLocationIds = new Set(snapshot.locationIds);

  for (const phone of snapshot.phoneNumbers) {
    if (phone.locationId && !practiceLocationIds.has(phone.locationId)) {
      addAmbiguity("LOCATION_REFERENCE_OUTSIDE_PRACTICE", `phone:${phone.id}`);
    }
  }

  for (const seat of snapshot.seats) {
    if (seat.locationId && !practiceLocationIds.has(seat.locationId)) {
      addAmbiguity("LOCATION_REFERENCE_OUTSIDE_PRACTICE", `seat:${seat.id}`);
    }
  }

  if (!snapshot.settings) addAmbiguity("LEGACY_SETTINGS_MISSING", "settings");
  if (!snapshot.seats.length) addAmbiguity("NO_LEGACY_SEATS", "seats");
  const hasExistingGenericConfiguration = Boolean(
    snapshot.existingGenericConfiguration.endpointCount ||
    snapshot.existingGenericConfiguration.numberCount ||
    snapshot.existingGenericConfiguration.queueCount,
  );
  if (hasExistingGenericConfiguration) {
    addAmbiguity("GENERIC_CONFIGURATION_PRESENT", "generic-configuration");
  }

  const maxWaitSec = snapshot.settings
    ? effectiveLegacyMaxWait(snapshot.settings.voicemailTimeoutSec)
    : null;
  const ringTimeoutSec = maxWaitSec
    ? Math.min(LEGACY_AGENT_RING_TIMEOUT_SEC, maxWaitSec)
    : null;
  const voicemailGreetingConfigured = Boolean(
    snapshot.settings?.voicemailGreeting.trim(),
  );
  if (snapshot.settings && !voicemailGreetingConfigured) {
    addAmbiguity("VOICEMAIL_GREETING_MISSING", "settings");
  }

  const queueBySource = new Map<string, MutableQueue>();
  const queueIdBySeatId = new Map<string, string>();
  for (const seat of [...snapshot.seats].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = queueSourceForSeat(seat);
    const sourceLocationIsValid =
      source?.kind !== "LOCATION_SCOPE" || practiceLocationIds.has(source.value);
    if (!source || !sourceLocationIsValid) {
      addAmbiguity("SEAT_SCOPE_MISSING", `seat:${seat.id}`);
      continue;
    }
    const key = queueMapKey(source);
    const queue =
      queueBySource.get(key) ??
      ({
        ...source,
        proposedId: opaqueId("ccq", snapshot.practiceId, source.kind, source.value),
        locationIds: new Set<string>(),
        memberUserIds: new Set<string>(),
        sourceSeatIds: new Set<string>(),
        endpointIds: new Set<string>(),
      } satisfies MutableQueue);
    if (seat.locationId && practiceLocationIds.has(seat.locationId)) {
      queue.locationIds.add(seat.locationId);
    }
    queue.sourceSeatIds.add(seat.id);
    seat.observedUserIds.forEach((userId) => queue.memberUserIds.add(userId));
    queueBySource.set(key, queue);
    queueIdBySeatId.set(seat.id, queue.proposedId);
  }

  for (const assignment of snapshot.profileAssignments) {
    const source: QueueSource = {
      kind: "EXPLICIT_QUEUE_KEY",
      value: assignment.queueKey,
    };
    const queue = queueBySource.get(queueMapKey(source));
    if (queue) {
      queue.memberUserIds.add(assignment.userId);
      assignment.locationIds.forEach((locationId) => {
        if (practiceLocationIds.has(locationId)) {
          queue.locationIds.add(locationId);
        } else {
          addAmbiguity(
            "LOCATION_REFERENCE_OUTSIDE_PRACTICE",
            `profile-user:${assignment.userId}`,
          );
        }
      });
    } else {
      addAmbiguity("PROFILE_QUEUE_WITHOUT_SEAT", `profile-user:${assignment.userId}`);
    }
  }

  const credentialCounts = identityCounts(
    snapshot.seats.map(({ providerCredentialId }) => providerCredentialId),
  );
  const sipUsernameCounts = identityCounts(
    snapshot.seats.map(({ sipUsername }) => sipUsername),
  );
  const queueById = new Map(
    [...queueBySource.values()].map((queue) => [queue.proposedId, queue]),
  );
  const endpoints = [...snapshot.seats]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((seat) => {
      const providerCredential = cleanOptional(seat.providerCredentialId);
      const sipUsername = cleanOptional(seat.sipUsername);
      const duplicate = Boolean(
        (providerCredential && (credentialCounts.get(providerCredential) ?? 0) > 1) ||
        (sipUsername && (sipUsernameCounts.get(sipUsername) ?? 0) > 1),
      );
      const incomplete = !providerCredential || !sipUsername;
      const identityStatus = duplicate
        ? ("DUPLICATE" as const)
        : incomplete
          ? ("INCOMPLETE" as const)
          : ("CONFIGURED" as const);
      const proposedId = seat.id;
      const queueId = queueIdBySeatId.get(seat.id) ?? null;
      if (queueId) queueById.get(queueId)?.endpointIds.add(proposedId);
      if (duplicate) {
        addAmbiguity("ENDPOINT_IDENTITY_DUPLICATE", `seat:${seat.id}`);
      } else if (incomplete && seat.enabled) {
        addAmbiguity("ENDPOINT_IDENTITY_INCOMPLETE", `seat:${seat.id}`);
      }
      return {
        proposedId,
        proposedLabel: `Imported endpoint ${proposedId.slice(-8)}`,
        sourceSeatId: seat.id,
        queueId,
        locationId:
          seat.locationId && practiceLocationIds.has(seat.locationId)
            ? seat.locationId
            : null,
        enabled: seat.enabled,
        providerCredentialConfigured: Boolean(providerCredential),
        sipUsernameConfigured: Boolean(sipUsername),
        identityStatus,
      };
    });

  const endpointById = new Map(
    endpoints.map((endpoint) => [endpoint.proposedId, endpoint]),
  );
  const mutableQueues = [...queueBySource.values()].sort((a, b) =>
    a.proposedId.localeCompare(b.proposedId),
  );
  for (const queue of mutableQueues) {
    if (!queue.locationIds.size) {
      addAmbiguity("QUEUE_LOCATION_MISSING", `queue:${queue.proposedId}`);
    }
    if (!queue.memberUserIds.size) {
      addAmbiguity("QUEUE_MEMBER_MISSING", `queue:${queue.proposedId}`);
    }
    const hasReadyEndpoint = [...queue.endpointIds].some((endpointId) => {
      const endpoint = endpointById.get(endpointId);
      return endpoint?.enabled && endpoint.identityStatus === "CONFIGURED";
    });
    if (!hasReadyEndpoint) {
      addAmbiguity("QUEUE_WITHOUT_READY_ENDPOINT", `queue:${queue.proposedId}`);
    }
  }

  const numberByPhoneId = new Map<
    string,
    LegacyCallCenterBackfillReport["numbers"][number]
  >();
  let inboundQueueId: string | null = null;
  const inboundConfigured = cleanOptional(snapshot.settings?.inboundPhoneNumber);
  if (!inboundConfigured) {
    addAmbiguity("INBOUND_NUMBER_NOT_CONFIGURED", "settings");
  } else {
    const matches = phoneMatches(inboundConfigured, snapshot.phoneNumbers);
    if (!matches.length) {
      addAmbiguity("INBOUND_NUMBER_NOT_FOUND", "settings");
    } else if (matches.length > 1) {
      matches.forEach(({ id }) =>
        addAmbiguity("INBOUND_NUMBER_MATCH_AMBIGUOUS", `phone:${id}`),
      );
    } else {
      const [phone] = matches;
      const candidates = phone.locationId
        ? mutableQueues.filter(({ locationIds }) => locationIds.has(phone.locationId!))
        : mutableQueues;
      if (candidates.length === 1) {
        inboundQueueId = candidates[0]!.proposedId;
      } else if (!candidates.length) {
        addAmbiguity("INBOUND_QUEUE_NOT_FOUND", `phone:${phone.id}`);
      } else {
        addAmbiguity("INBOUND_QUEUE_MATCH_AMBIGUOUS", `phone:${phone.id}`);
      }
      const proposedId = opaqueId("ccn", snapshot.practiceId, phone.id);
      numberByPhoneId.set(phone.id, {
        proposedId,
        practicePhoneNumberId: phone.id,
        enabled: Boolean(snapshot.settings?.enabled),
        inboundEnabled: Boolean(snapshot.settings?.enabled && inboundQueueId),
        inboundQueueId,
        outboundEnabled: false,
        providerNumberIdConfigured: false,
      });
    }
  }

  let defaultOutboundNumberId: string | null = null;
  const outboundConfigured = cleanOptional(snapshot.settings?.outboundCallerNumber);
  if (!outboundConfigured) {
    addAmbiguity("OUTBOUND_NUMBER_NOT_CONFIGURED", "settings");
  } else {
    const matches = phoneMatches(outboundConfigured, snapshot.phoneNumbers);
    if (!matches.length) {
      addAmbiguity("OUTBOUND_NUMBER_NOT_FOUND", "settings");
    } else if (matches.length > 1) {
      matches.forEach(({ id }) =>
        addAmbiguity("OUTBOUND_NUMBER_MATCH_AMBIGUOUS", `phone:${id}`),
      );
    } else {
      const [phone] = matches;
      const proposedId = opaqueId("ccn", snapshot.practiceId, phone.id);
      const existing = numberByPhoneId.get(phone.id);
      numberByPhoneId.set(phone.id, {
        proposedId,
        practicePhoneNumberId: phone.id,
        enabled: Boolean(snapshot.settings?.enabled),
        inboundEnabled: existing?.inboundEnabled ?? false,
        inboundQueueId: existing?.inboundQueueId ?? null,
        outboundEnabled: Boolean(snapshot.settings?.enabled),
        providerNumberIdConfigured: false,
      });
      if (snapshot.settings?.enabled) defaultOutboundNumberId = proposedId;
    }
  }

  const numbers = [...numberByPhoneId.values()].sort((a, b) =>
    a.proposedId.localeCompare(b.proposedId),
  );
  const inboundQueueIds = new Set(
    numbers.flatMap(({ inboundEnabled, inboundQueueId }) =>
      inboundEnabled && inboundQueueId ? [inboundQueueId] : [],
    ),
  );
  const enabledSeatIds = new Set(
    snapshot.seats.filter(({ enabled }) => enabled).map(({ id }) => id),
  );
  const queues = mutableQueues.map((queue) => {
    const endpointIds = sorted(queue.endpointIds);
    const hasReadyEndpoint = endpointIds.some((endpointId) => {
      const endpoint = endpointById.get(endpointId);
      return endpoint?.enabled && endpoint.identityStatus === "CONFIGURED";
    });
    const readyForReview = Boolean(
      snapshot.settings?.enabled &&
      !hasExistingGenericConfiguration &&
      voicemailGreetingConfigured &&
      queue.locationIds.size &&
      queue.memberUserIds.size &&
      hasReadyEndpoint &&
      inboundQueueIds.has(queue.proposedId),
    );
    return {
      proposedId: queue.proposedId,
      proposedName: `Imported queue ${queue.proposedId.slice(-8)}`,
      source: queue.kind,
      enabled: Boolean(
        snapshot.settings?.enabled &&
        [...queue.sourceSeatIds].some((seatId) => enabledSeatIds.has(seatId)),
      ),
      routingMode: "LEGACY" as const,
      nextModeAfterReview: readyForReview ? ("SHADOW" as const) : null,
      locationIds: sorted(queue.locationIds),
      memberUserIds: sorted(queue.memberUserIds),
      sourceSeatIds: sorted(queue.sourceSeatIds),
      endpointIds,
      ringTimeoutSec,
      maxWaitSec,
      wrapUpSec: 0 as const,
      voicemailEnabled: Boolean(snapshot.settings),
      voicemailGreetingConfigured,
      shadowReadiness: readyForReview
        ? ("READY_FOR_REVIEW" as const)
        : ("BLOCKED" as const),
    };
  });

  const ambiguityList = [...ambiguities.entries()]
    .map(([code, references]) => ({
      code,
      count: references.size,
      affectedRefs: sorted(references),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    kind: "LEGACY_CALL_CENTER_BACKFILL_REPORT",
    mode: "REPORT_ONLY",
    practiceId: snapshot.practiceId,
    writeSupported: false,
    overallReadiness: ambiguityList.length === 0 ? "READY_FOR_MANUAL_REVIEW" : "BLOCKED",
    settings: {
      detected: Boolean(snapshot.settings),
      enabled: Boolean(snapshot.settings?.enabled),
      recordingEnabled: snapshot.settings?.recordingEnabled ?? null,
      voicemailGreetingConfigured,
      effectiveMaxWaitSec: maxWaitSec,
      databaseConnectionConfigured: Boolean(snapshot.settings?.telnyxConnectionId),
      databaseCredentialConfigured: Boolean(snapshot.settings?.telnyxCredentialId),
      runtimeFallbacks: snapshot.runtimeFallbacks,
    },
    queues,
    numbers,
    endpoints,
    defaultOutboundNumberId,
    ambiguities: ambiguityList,
    summary: {
      ambiguityCategoryCount: ambiguityList.length,
      ambiguityOccurrenceCount: ambiguityList.reduce(
        (sum, issue) => sum + issue.count,
        0,
      ),
      endpointCount: endpoints.length,
      existingGenericEndpointCount: snapshot.existingGenericConfiguration.endpointCount,
      existingGenericNumberCount: snapshot.existingGenericConfiguration.numberCount,
      existingGenericQueueCount: snapshot.existingGenericConfiguration.queueCount,
      numberCount: numbers.length,
      queueCount: queues.length,
      shadowReadyQueueCount: queues.filter(
        ({ shadowReadiness }) => shadowReadiness === "READY_FOR_REVIEW",
      ).length,
    },
  };
}
