import type { AgentCallStatusValue, VoiceExperimentMetadata } from "@/lib/call-types";
import { phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

type VoiceExperimentCall = {
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  confirmedAppointment: boolean;
  data: unknown;
  durationSec: number;
  officePhone?: string | null;
  status?: AgentCallStatusValue | string | null;
  toolCalls: number;
  toolErrors: number;
  transferred: boolean;
};

type ToolExecution = {
  outputClass?: string;
  status?: string;
  toolName?: string;
};

type VariantAccumulator = {
  abandonedCalls: number;
  appointmentActionCalls: number;
  bookedCalls: number;
  cancelledCalls: number;
  capturedCalls: number;
  confirmedCalls: number;
  confusionCalls: number;
  durationSec: number;
  earlyRepresentativeCalls: number;
  falseInterruptions: number;
  languageSwitchCalls: number;
  metadata: VoiceExperimentMetadata;
  overlappingSpeech: number;
  resolvedActionCalls: number;
  toolCalls: number;
  toolErrors: number;
  totalCalls: number;
  transferredCalls: number;
};

export type VoiceExperimentVariantReport = {
  abandonedCalls: number;
  abandonedRate: number;
  appointmentActionCalls: number;
  appointmentActionRate: number;
  averageDurationSec: number;
  capturedCalls: number;
  captureRate: number;
  confusionCalls: number;
  confusionRate: number;
  earlyRepresentativeCalls: number;
  earlyRepresentativeRate: number;
  falseInterruptions: number;
  languageSwitchCalls: number;
  languageSwitchRate: number;
  metadata: VoiceExperimentMetadata;
  overlappingSpeech: number;
  resolvedActionCalls: number;
  resolvedActionRate: number;
  toolCalls: number;
  toolErrorRate: number;
  toolErrors: number;
  totalCalls: number;
  transferredCalls: number;
  transferRate: number;
  variant: string;
};

export type VoiceExperimentReport = {
  experimentId: string;
  totalCalls: number;
  variants: VoiceExperimentVariantReport[];
};

const RESOLVED_OUTPUT_CLASSES = new Set([
  "appointment_booked",
  "appointment_cancelled",
  "appointment_rescheduled",
  "appointments_found",
  "insurance_checked",
  "insurance_updated",
  "knowledge_returned",
  "patient_created",
]);

const REPRESENTATIVE_RE =
  /\b(representative|human|person|operator|front desk|staff|someone|agent)\b/i;

const CONFUSION_RE =
  /\b(repeat|say that again|what did you say|i don't understand|confused|can't hear|can you hear)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function getVoiceExperiment(data: unknown): VoiceExperimentMetadata | null {
  if (!isRecord(data) || !isRecord(data.voiceExperiment)) return null;

  const experimentId = asString(data.voiceExperiment.experimentId);
  const variant = asString(data.voiceExperiment.variant);
  if (!experimentId || !variant) return null;

  return {
    ...(asString(data.voiceExperiment.assignment)
      ? { assignment: asString(data.voiceExperiment.assignment) ?? undefined }
      : {}),
    ...(asString(data.voiceExperiment.assignmentHash)
      ? { assignmentHash: asString(data.voiceExperiment.assignmentHash) ?? undefined }
      : {}),
    experimentId,
    ...(asString(data.voiceExperiment.model)
      ? { model: asString(data.voiceExperiment.model) ?? undefined }
      : {}),
    ...(asString(data.voiceExperiment.provider)
      ? { provider: asString(data.voiceExperiment.provider) ?? undefined }
      : {}),
    ...(asString(data.voiceExperiment.scope)
      ? { scope: asString(data.voiceExperiment.scope) ?? undefined }
      : {}),
    ...(asString(data.voiceExperiment.speaker)
      ? { speaker: asString(data.voiceExperiment.speaker) ?? undefined }
      : {}),
    variant,
    ...(asString(data.voiceExperiment.voiceId)
      ? { voiceId: asString(data.voiceExperiment.voiceId) ?? undefined }
      : {}),
  };
}

function getToolExecutions(data: unknown): ToolExecution[] {
  if (!isRecord(data) || !Array.isArray(data.toolExecutions)) return [];

  return data.toolExecutions.filter(isRecord).map((tool) => ({
    ...(asString(tool.outputClass)
      ? { outputClass: asString(tool.outputClass) ?? undefined }
      : {}),
    ...(asString(tool.status) ? { status: asString(tool.status) ?? undefined } : {}),
    ...(asString(tool.toolName)
      ? { toolName: asString(tool.toolName) ?? undefined }
      : {}),
  }));
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) return asString(item.transcript) ?? "";
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function callerTexts(data: unknown): string[] {
  if (!isRecord(data)) return [];

  if (Array.isArray(data.turns)) {
    const turnTexts = data.turns
      .filter(isRecord)
      .map((turn) => asString(turn.callerText))
      .filter((text): text is string => Boolean(text));
    if (turnTexts.length > 0) return turnTexts;
  }

  const items = isRecord(data.sessionReport)
    ? isRecord(data.sessionReport.chat_history)
      ? data.sessionReport.chat_history.items
      : undefined
    : undefined;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => isRecord(item) && item.type === "message" && item.role === "user")
    .map((item) => extractText(item.content))
    .filter(Boolean);
}

function countArray(data: unknown, key: string): number {
  return isRecord(data) && Array.isArray(data[key]) ? data[key].length : 0;
}

function observabilityCounts(data: unknown) {
  if (!isRecord(data) || !isRecord(data.sessionEvents)) {
    return { falseInterruptions: 0, overlappingSpeech: 0 };
  }

  return {
    falseInterruptions: countArray(data.sessionEvents, "falseInterruptions"),
    overlappingSpeech: countArray(data.sessionEvents, "overlappingSpeech"),
  };
}

function languageSwitched(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.language)) return false;
  return (
    data.language.languageChanged === true || asNumber(data.language.languageSwitches) > 0
  );
}

function callSignals(call: VoiceExperimentCall) {
  const toolExecutions = getToolExecutions(call.data);
  const successfulClasses = new Set(
    toolExecutions
      .filter((tool) => tool.status === "success")
      .map((tool) => tool.outputClass)
      .filter((value): value is string => Boolean(value)),
  );
  const transferred =
    call.transferred ||
    successfulClasses.has("transfer_started") ||
    toolExecutions.some(
      (tool) => tool.status === "success" && tool.toolName === "transfer_call",
    );
  const booked =
    call.bookedAppointment ||
    successfulClasses.has("appointment_booked") ||
    successfulClasses.has("appointment_rescheduled");
  const confirmed =
    call.confirmedAppointment || successfulClasses.has("appointments_found");
  const cancelled =
    call.cancelledAppointment ||
    successfulClasses.has("appointment_cancelled") ||
    successfulClasses.has("appointment_rescheduled");
  const resolvedAction =
    booked ||
    confirmed ||
    cancelled ||
    [...successfulClasses].some((outputClass) =>
      RESOLVED_OUTPUT_CLASSES.has(outputClass),
    );
  const texts = callerTexts(call.data);
  const firstTwoCallerTurns = texts.slice(0, 2).join(" ");
  const earlyRepresentative = REPRESENTATIVE_RE.test(firstTwoCallerTurns);
  const confusion = CONFUSION_RE.test(texts.join(" "));
  const observability = observabilityCounts(call.data);
  const toolCalls = toolExecutions.length > 0 ? toolExecutions.length : call.toolCalls;
  const toolErrors =
    toolExecutions.length > 0
      ? toolExecutions.filter((tool) => tool.status === "error").length
      : call.toolErrors;

  return {
    abandoned: call.status === "ABANDONED",
    appointmentAction: booked || confirmed || cancelled,
    booked,
    cancelled,
    captured: resolvedAction && !transferred,
    confirmed,
    confusion,
    earlyRepresentative,
    languageSwitched: languageSwitched(call.data),
    resolvedAction,
    toolCalls,
    toolErrors,
    transferred,
    ...observability,
  };
}

function emptyAccumulator(metadata: VoiceExperimentMetadata): VariantAccumulator {
  return {
    abandonedCalls: 0,
    appointmentActionCalls: 0,
    bookedCalls: 0,
    cancelledCalls: 0,
    capturedCalls: 0,
    confirmedCalls: 0,
    confusionCalls: 0,
    durationSec: 0,
    earlyRepresentativeCalls: 0,
    falseInterruptions: 0,
    languageSwitchCalls: 0,
    metadata,
    overlappingSpeech: 0,
    resolvedActionCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    totalCalls: 0,
    transferredCalls: 0,
  };
}

function toVariantReport(accumulator: VariantAccumulator): VoiceExperimentVariantReport {
  const total = accumulator.totalCalls;

  return {
    abandonedCalls: accumulator.abandonedCalls,
    abandonedRate: rate(accumulator.abandonedCalls, total),
    appointmentActionCalls: accumulator.appointmentActionCalls,
    appointmentActionRate: rate(accumulator.appointmentActionCalls, total),
    averageDurationSec: total > 0 ? accumulator.durationSec / total : 0,
    capturedCalls: accumulator.capturedCalls,
    captureRate: rate(accumulator.capturedCalls, total),
    confusionCalls: accumulator.confusionCalls,
    confusionRate: rate(accumulator.confusionCalls, total),
    earlyRepresentativeCalls: accumulator.earlyRepresentativeCalls,
    earlyRepresentativeRate: rate(accumulator.earlyRepresentativeCalls, total),
    falseInterruptions: accumulator.falseInterruptions,
    languageSwitchCalls: accumulator.languageSwitchCalls,
    languageSwitchRate: rate(accumulator.languageSwitchCalls, total),
    metadata: accumulator.metadata,
    overlappingSpeech: accumulator.overlappingSpeech,
    resolvedActionCalls: accumulator.resolvedActionCalls,
    resolvedActionRate: rate(accumulator.resolvedActionCalls, total),
    toolCalls: accumulator.toolCalls,
    toolErrorRate: rate(accumulator.toolErrors, accumulator.toolCalls),
    toolErrors: accumulator.toolErrors,
    totalCalls: total,
    transferredCalls: accumulator.transferredCalls,
    transferRate: rate(accumulator.transferredCalls, total),
    variant: accumulator.metadata.variant,
  };
}

export function buildVoiceExperimentReport(
  calls: VoiceExperimentCall[],
  experimentId: string,
): VoiceExperimentReport {
  const byVariant = new Map<string, VariantAccumulator>();

  for (const call of calls) {
    const metadata = getVoiceExperiment(call.data);
    if (metadata?.experimentId !== experimentId) continue;

    const accumulator = byVariant.get(metadata.variant) ?? emptyAccumulator(metadata);
    const signals = callSignals(call);

    accumulator.totalCalls += 1;
    accumulator.durationSec += call.durationSec;
    accumulator.toolCalls += signals.toolCalls;
    accumulator.toolErrors += signals.toolErrors;
    accumulator.falseInterruptions += signals.falseInterruptions;
    accumulator.overlappingSpeech += signals.overlappingSpeech;
    if (signals.abandoned) accumulator.abandonedCalls += 1;
    if (signals.appointmentAction) accumulator.appointmentActionCalls += 1;
    if (signals.booked) accumulator.bookedCalls += 1;
    if (signals.cancelled) accumulator.cancelledCalls += 1;
    if (signals.captured) accumulator.capturedCalls += 1;
    if (signals.confirmed) accumulator.confirmedCalls += 1;
    if (signals.confusion) accumulator.confusionCalls += 1;
    if (signals.earlyRepresentative) accumulator.earlyRepresentativeCalls += 1;
    if (signals.languageSwitched) accumulator.languageSwitchCalls += 1;
    if (signals.resolvedAction) accumulator.resolvedActionCalls += 1;
    if (signals.transferred) accumulator.transferredCalls += 1;

    byVariant.set(metadata.variant, accumulator);
  }

  const variants = [...byVariant.values()]
    .map(toVariantReport)
    .sort((left, right) => left.variant.localeCompare(right.variant));

  return {
    experimentId,
    totalCalls: variants.reduce((sum, variant) => sum + variant.totalCalls, 0),
    variants,
  };
}

export async function getVoiceExperimentReport(input: {
  experimentId: string;
  officePhones?: string[];
  practiceId: string;
  rangeStart?: Date | null;
}): Promise<VoiceExperimentReport> {
  const officePhoneVariants = [
    ...new Set((input.officePhones ?? []).flatMap(phoneLookupVariants)),
  ];
  const calls = await prisma.agentCall.findMany({
    orderBy: {
      startedAt: "desc",
    },
    select: {
      bookedAppointment: true,
      cancelledAppointment: true,
      confirmedAppointment: true,
      data: true,
      durationSec: true,
      officePhone: true,
      status: true,
      toolCalls: true,
      toolErrors: true,
      transferred: true,
    },
    where: {
      ...(officePhoneVariants.length > 0
        ? { officePhone: { in: officePhoneVariants } }
        : {}),
      ...(input.rangeStart ? { startedAt: { gte: input.rangeStart } } : {}),
      practiceId: input.practiceId,
    },
  });

  return buildVoiceExperimentReport(calls, input.experimentId);
}
