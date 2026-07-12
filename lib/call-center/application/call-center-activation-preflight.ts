export const CALL_CENTER_ACTIVATION_REQUIRED_MIGRATIONS = [
  "20260712150000_call_center_effect_owner",
  "20260712160000_call_center_active_routing_ordering_deadlines",
] as const;

export const CALL_CENTER_COMMAND_CONFIRMATION_GRACE_MS = 2 * 60_000;
export const CALL_CENTER_ENDPOINT_HEARTBEAT_FRESHNESS_MS = 30_000;

export type CallCenterActivationPreflightFacts = {
  ambiguousCommandCount: number;
  ambiguousEventCount: number;
  blockedCommandCount: number;
  commandDeadLetterCount: number;
  enabledNumberCount: number;
  enabledQueueCount: number;
  eventDeadLetterCount: number;
  incompleteNumberCount: number;
  incompleteQueueCount: number;
  missingMigrationCount: number;
  readyTestEndpointCount: number;
  runtimeConfigReadyCount: number;
  staleSentCommandCount: number;
  unresolvedOwnershipCount: number;
};

export interface CallCenterActivationPreflightStore {
  inspect(input: {
    confirmationCutoff: Date;
    heartbeatCutoff: Date;
    now: Date;
    requiredMigrations: readonly string[];
    runtimeConfigReady: boolean;
    testEndpointId: string;
  }): Promise<CallCenterActivationPreflightFacts>;
}

export type CallCenterActivationPreflightCheck = {
  code:
    | "MIGRATIONS_APPLIED"
    | "RUNTIME_CONFIG_READY"
    | "ENABLED_QUEUES_COMPLETE"
    | "ENABLED_NUMBERS_COMPLETE"
    | "CALLBACK_OWNERSHIP_RESOLVED"
    | "COMMANDS_CONFIRMED"
    | "COMMAND_DEPENDENCIES_CLEAR"
    | "COMMAND_DEAD_LETTERS_CLEAR"
    | "EVENT_DEAD_LETTERS_CLEAR"
    | "COMMAND_CORRELATION_UNAMBIGUOUS"
    | "EVENT_CORRELATION_UNAMBIGUOUS"
    | "READY_TEST_ENDPOINT";
  count: number;
  passed: boolean;
};

export type CallCenterActivationPreflightResult =
  | {
      checkedAt: Date;
      checks: CallCenterActivationPreflightCheck[];
      facts: CallCenterActivationPreflightFacts;
      ready: boolean;
    }
  | {
      checkedAt: Date;
      errorCode: "ACTIVATION_PREFLIGHT_QUERY_FAILED";
      ready: false;
    };

export function evaluateCallCenterActivationPreflight(
  facts: CallCenterActivationPreflightFacts,
  checkedAt: Date,
): CallCenterActivationPreflightResult {
  const checks: CallCenterActivationPreflightCheck[] = [
    {
      code: "RUNTIME_CONFIG_READY",
      count: facts.runtimeConfigReadyCount,
      passed: facts.runtimeConfigReadyCount === 1,
    },
    {
      code: "MIGRATIONS_APPLIED",
      count: facts.missingMigrationCount,
      passed: facts.missingMigrationCount === 0,
    },
    {
      code: "ENABLED_QUEUES_COMPLETE",
      count: facts.incompleteQueueCount,
      passed: facts.enabledQueueCount > 0 && facts.incompleteQueueCount === 0,
    },
    {
      code: "ENABLED_NUMBERS_COMPLETE",
      count: facts.incompleteNumberCount,
      passed: facts.enabledNumberCount > 0 && facts.incompleteNumberCount === 0,
    },
    {
      code: "CALLBACK_OWNERSHIP_RESOLVED",
      count: facts.unresolvedOwnershipCount,
      passed: facts.unresolvedOwnershipCount === 0,
    },
    {
      code: "COMMANDS_CONFIRMED",
      count: facts.staleSentCommandCount,
      passed: facts.staleSentCommandCount === 0,
    },
    {
      code: "COMMAND_DEPENDENCIES_CLEAR",
      count: facts.blockedCommandCount,
      passed: facts.blockedCommandCount === 0,
    },
    {
      code: "COMMAND_DEAD_LETTERS_CLEAR",
      count: facts.commandDeadLetterCount,
      passed: facts.commandDeadLetterCount === 0,
    },
    {
      code: "EVENT_DEAD_LETTERS_CLEAR",
      count: facts.eventDeadLetterCount,
      passed: facts.eventDeadLetterCount === 0,
    },
    {
      code: "COMMAND_CORRELATION_UNAMBIGUOUS",
      count: facts.ambiguousCommandCount,
      passed: facts.ambiguousCommandCount === 0,
    },
    {
      code: "EVENT_CORRELATION_UNAMBIGUOUS",
      count: facts.ambiguousEventCount,
      passed: facts.ambiguousEventCount === 0,
    },
    {
      code: "READY_TEST_ENDPOINT",
      count: facts.readyTestEndpointCount,
      passed: facts.readyTestEndpointCount > 0,
    },
  ];

  return {
    checkedAt,
    checks,
    facts,
    ready: checks.every(({ passed }) => passed),
  };
}

export async function runCallCenterActivationPreflight(
  store: CallCenterActivationPreflightStore,
  input: {
    now?: Date;
    runtimeConfigReady?: () => boolean;
    testEndpointId: string;
  },
): Promise<CallCenterActivationPreflightResult> {
  const now = input.now ?? new Date();

  try {
    const runtimeConfigReady = input.runtimeConfigReady?.() === true;
    const facts = await store.inspect({
      confirmationCutoff: new Date(
        now.getTime() - CALL_CENTER_COMMAND_CONFIRMATION_GRACE_MS,
      ),
      heartbeatCutoff: new Date(
        now.getTime() - CALL_CENTER_ENDPOINT_HEARTBEAT_FRESHNESS_MS,
      ),
      now,
      requiredMigrations: CALL_CENTER_ACTIVATION_REQUIRED_MIGRATIONS,
      runtimeConfigReady,
      testEndpointId: input.testEndpointId.trim(),
    });
    return evaluateCallCenterActivationPreflight(facts, now);
  } catch {
    return {
      checkedAt: now,
      errorCode: "ACTIVATION_PREFLIGHT_QUERY_FAILED",
      ready: false,
    };
  }
}
