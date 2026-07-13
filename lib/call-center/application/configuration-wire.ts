import { z } from "zod";

import type {
  CallCenterConfigurationInput,
  ValidatedCallCenterConfiguration,
} from "@/lib/call-center/application/configuration";

const idSchema = z.string().trim().min(1).max(255);
const optionalIdSchema = idSchema.nullable();
const MAX_CONFIGURATION_ENDPOINTS = 250;
const MAX_CONFIGURATION_MEMBERS = 500;

const queueMemberSchema = z
  .object({
    userId: idSchema,
    role: z.enum(["AGENT", "SUPERVISOR"]),
    enabled: z.boolean(),
  })
  .strict();

const queueSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    routingMode: z.enum(["LEGACY", "SHADOW", "ACTIVE"]),
    ringTimeoutSec: z.number().int(),
    maxWaitSec: z.number().int(),
    wrapUpSec: z.number().int(),
    voicemailEnabled: z.boolean(),
    voicemailGreeting: z.string().trim().max(2_000),
    overflowQueueId: optionalIdSchema,
    locationIds: z.array(idSchema).max(100),
    members: z.array(queueMemberSchema).max(500),
  })
  .strict();

const numberSchema = z
  .object({
    id: idSchema,
    practicePhoneNumberId: idSchema,
    providerNumberId: optionalIdSchema,
    inboundQueueId: optionalIdSchema,
    inboundEnabled: z.boolean(),
    outboundEnabled: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();

const endpointSchema = z
  .object({
    id: idSchema,
    /** Omitted preserves the current server-side assignment; null clears it. */
    userId: optionalIdSchema.optional(),
    locationId: optionalIdSchema,
    label: z.string().trim().min(1).max(100),
    /** Omitted preserves the current server-side value; null clears it. */
    providerCredentialId: optionalIdSchema.optional(),
    /** Omitted preserves the current server-side value; null clears it. */
    sipUsername: optionalIdSchema.optional(),
    providerCredentialConfigured: z.boolean().optional(),
    sipUsernameConfigured: z.boolean().optional(),
    enabled: z.boolean(),
  })
  .strict();

export const callCenterConfigurationWireSchema = z
  .object({
    defaultOutboundNumberId: optionalIdSchema,
    queues: z.array(queueSchema).max(100),
    numbers: z.array(numberSchema).max(100),
    endpoints: z.array(endpointSchema).max(MAX_CONFIGURATION_ENDPOINTS),
  })
  .strict()
  .superRefine((configuration, context) => {
    const memberCount = configuration.queues.reduce(
      (total, queue) => total + queue.members.length,
      0,
    );
    if (memberCount > MAX_CONFIGURATION_MEMBERS) {
      context.addIssue({
        code: "custom",
        message: `At most ${MAX_CONFIGURATION_MEMBERS} queue memberships are allowed`,
        path: ["queues"],
      });
    }
  });

export type CallCenterConfigurationWireInput = z.infer<
  typeof callCenterConfigurationWireSchema
>;

export function resolveCallCenterConfigurationWireInput(
  practiceId: string,
  input: CallCenterConfigurationWireInput,
  current: ValidatedCallCenterConfiguration,
): CallCenterConfigurationInput {
  const currentEndpoints = new Map(
    current.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  return {
    practiceId,
    ...input,
    endpoints: input.endpoints.map((endpoint) => {
      const existing = currentEndpoints.get(endpoint.id);
      return {
        id: endpoint.id,
        userId:
          endpoint.userId === undefined ? (existing?.userId ?? null) : endpoint.userId,
        locationId: endpoint.locationId,
        label: endpoint.label,
        enabled: endpoint.enabled,
        providerCredentialId:
          endpoint.providerCredentialId === undefined
            ? (existing?.providerCredentialId ?? null)
            : endpoint.providerCredentialId,
        sipUsername:
          endpoint.sipUsername === undefined
            ? (existing?.sipUsername ?? null)
            : endpoint.sipUsername,
      };
    }),
  };
}

export function redactCallCenterConfiguration(
  configuration: ValidatedCallCenterConfiguration,
) {
  return {
    defaultOutboundNumberId: configuration.defaultOutboundNumberId,
    queues: configuration.queues,
    numbers: configuration.numbers,
    endpoints: configuration.endpoints.map(
      ({ providerCredentialId, sipUsername, ...endpoint }) => ({
        ...endpoint,
        providerCredentialConfigured: Boolean(providerCredentialId),
        sipUsernameConfigured: Boolean(sipUsername),
      }),
    ),
  };
}

const configurationVersionSchema = z.string().regex(/^[a-f0-9]{64}$/);

export function formatConfigurationEtag(version: string) {
  return `"${configurationVersionSchema.parse(version)}"`;
}

export function parseConfigurationEtag(value: string | null) {
  if (!value) return null;
  const match = /^"([a-f0-9]{64})"$/.exec(value.trim());
  return match && configurationVersionSchema.safeParse(match[1]).success
    ? match[1]
    : null;
}

export function safeZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    code: "INVALID_REQUEST" as const,
    path: issue.path.join("."),
    message: issue.message,
  }));
}
