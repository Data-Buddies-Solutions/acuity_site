import type { CostCategoryValue, CostLineEstimate } from "@/lib/call-types";

export const USAGE_PRICING_RATES = {
  assemblyAiSttPerMinute: 0.0075,
  basetenCachedInputPerMillionTokens: 0.12,
  basetenInputPerMillionTokens: 0.6,
  basetenOutputPerMillionTokens: 2.2,
  cartesiaSonic35PerMillionCharacters: 39,
  liveKitPerMinute: 0.01,
  telnyxSipInboundPerMinute: 0.0035,
} as const;

export const ESTIMATED_USAGE_PROVIDERS = [
  "assemblyai",
  "baseten",
  "cartesia",
  "elevenlabs",
  "livekit",
  "telnyx",
  "estimated",
] as const;

type PricingUnit = "characters" | "minutes" | "tokens";

export type UsageCostInput = {
  cachedTokens: number;
  durationSec: number;
  inputTokens: number;
  llmModel?: string | null;
  outputTokens: number;
  ttsChars: number;
};

export type UsageCostBreakdownItem = {
  category: CostCategoryValue;
  costMicros: number;
  label: string;
  model: string | null;
  provider: string;
  quantity: number;
  rateLabel: string;
  unit: PricingUnit;
};

export type UsageCostBreakdown = {
  costPerCallMicros: number;
  costPerMinuteMicros: number;
  items: UsageCostBreakdownItem[];
  minutes: number;
  totalCostMicros: number;
};

function dollarsToMicros(dollars: number) {
  return Math.max(0, Math.round(dollars * 1_000_000));
}

function normalizeQuantity(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function costItem(input: {
  category: CostCategoryValue;
  costDollars: number;
  label: string;
  model?: string | null;
  provider: string;
  quantity: number;
  rateLabel: string;
  unit: PricingUnit;
}): UsageCostBreakdownItem {
  return {
    category: input.category,
    costMicros: dollarsToMicros(input.costDollars),
    label: input.label,
    model: input.model ?? null,
    provider: input.provider,
    quantity: input.quantity,
    rateLabel: input.rateLabel,
    unit: input.unit,
  };
}

export function calculateUsageCostBreakdown(
  input: UsageCostInput & { callCount?: number },
): UsageCostBreakdown {
  const durationSec = normalizeQuantity(input.durationSec);
  const minutes = durationSec / 60;
  const inputTokens = normalizeQuantity(input.inputTokens);
  const cachedTokens = normalizeQuantity(input.cachedTokens);
  const outputTokens = normalizeQuantity(input.outputTokens);
  const ttsChars = normalizeQuantity(input.ttsChars);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedTokens);

  const items: UsageCostBreakdownItem[] = [
    costItem({
      category: "TELEPHONY",
      costDollars: minutes * USAGE_PRICING_RATES.liveKitPerMinute,
      label: "LiveKit media",
      provider: "livekit",
      quantity: minutes,
      rateLabel: "$0.0100 / min",
      unit: "minutes",
    }),
    costItem({
      category: "TELEPHONY",
      costDollars: minutes * USAGE_PRICING_RATES.telnyxSipInboundPerMinute,
      label: "Telnyx SIP inbound",
      provider: "telnyx",
      quantity: minutes,
      rateLabel: "$0.0035 / min",
      unit: "minutes",
    }),
    costItem({
      category: "SPEECH_TO_TEXT",
      costDollars: minutes * USAGE_PRICING_RATES.assemblyAiSttPerMinute,
      label: "AssemblyAI STT",
      provider: "assemblyai",
      quantity: minutes,
      rateLabel: "$0.0075 / min",
      unit: "minutes",
    }),
    costItem({
      category: "LLM_INPUT",
      costDollars:
        (uncachedInputTokens / 1_000_000) *
        USAGE_PRICING_RATES.basetenInputPerMillionTokens,
      label: "Baseten GLM-4.7 input",
      model: input.llmModel ?? "GLM-4.7",
      provider: "baseten",
      quantity: uncachedInputTokens,
      rateLabel: "$0.60 / 1M tok",
      unit: "tokens",
    }),
    costItem({
      category: "LLM_CACHED_INPUT",
      costDollars:
        (cachedTokens / 1_000_000) *
        USAGE_PRICING_RATES.basetenCachedInputPerMillionTokens,
      label: "Baseten cached input",
      model: input.llmModel ?? "GLM-4.7",
      provider: "baseten",
      quantity: cachedTokens,
      rateLabel: "$0.12 / 1M tok",
      unit: "tokens",
    }),
    costItem({
      category: "LLM_OUTPUT",
      costDollars:
        (outputTokens / 1_000_000) * USAGE_PRICING_RATES.basetenOutputPerMillionTokens,
      label: "Baseten output",
      model: input.llmModel ?? "GLM-4.7",
      provider: "baseten",
      quantity: outputTokens,
      rateLabel: "$2.20 / 1M tok",
      unit: "tokens",
    }),
    costItem({
      category: "TEXT_TO_SPEECH",
      costDollars:
        (ttsChars / 1_000_000) * USAGE_PRICING_RATES.cartesiaSonic35PerMillionCharacters,
      label: "Cartesia Sonic 3.5 TTS",
      provider: "cartesia",
      quantity: ttsChars,
      rateLabel: "$39 / 1M chars",
      unit: "characters",
    }),
  ].filter((item) => item.quantity > 0 || item.costMicros > 0);

  const totalCostMicros = items.reduce((sum, item) => sum + item.costMicros, 0);
  const callCount = normalizeQuantity(input.callCount ?? 0);

  return {
    costPerCallMicros: callCount > 0 ? totalCostMicros / callCount : 0,
    costPerMinuteMicros: minutes > 0 ? totalCostMicros / minutes : 0,
    items,
    minutes,
    totalCostMicros,
  };
}

export function estimateUsageCostLineItems(input: UsageCostInput): CostLineEstimate[] {
  return calculateUsageCostBreakdown(input).items.map((item) => ({
    category: item.category,
    costMicros: item.costMicros,
    model: item.model,
    provider: item.provider,
    quantity: item.quantity,
    unit: item.unit,
  }));
}

export function microsToDollars(costMicros: number) {
  return costMicros / 1_000_000;
}
