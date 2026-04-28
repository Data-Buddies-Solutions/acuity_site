import type { AnalyticsData } from "@/lib/analytics";
import { formatDuration } from "@/lib/format";
import { calculateUsageCostBreakdown, microsToDollars } from "@/lib/pricing";
import { StatCard } from "@/app/components/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatCostMicros(costMicros: number): string {
  const dollars = microsToDollars(costMicros);

  if (dollars <= 0) {
    return "$0.00";
  }

  if (dollars < 0.01) {
    return `$${dollars.toFixed(4)}`;
  }

  if (dollars < 1) {
    return `$${dollars.toFixed(3)}`;
  }

  return `$${dollars.toFixed(2)}`;
}

function formatQuantity(quantity: number, unit: string) {
  if (unit === "minutes") {
    return `${quantity.toFixed(quantity >= 10 ? 1 : 2)} min`;
  }

  return quantity.toLocaleString(undefined, {
    maximumFractionDigits: unit === "tokens" || unit === "characters" ? 0 : 2,
  });
}

export function CostsTab({ data }: { data: AnalyticsData }) {
  const breakdown = calculateUsageCostBreakdown({
    cachedTokens: data.totalCachedTokens,
    callCount: data.totalCalls,
    durationSec: data.totalDurationSec,
    inputTokens: data.totalInputTokens,
    outputTokens: data.totalOutputTokens,
    ttsChars: data.totalTtsChars,
  });

  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vendor Cost"
          value={
            breakdown.totalCostMicros > 0
              ? formatCostMicros(breakdown.totalCostMicros)
              : "--"
          }
          sub={`${data.totalCalls.toLocaleString()} calls`}
          size="hero"
        />
        <StatCard
          label="Cost / Min"
          value={
            breakdown.costPerMinuteMicros > 0
              ? formatCostMicros(breakdown.costPerMinuteMicros)
              : "--"
          }
          sub={formatDuration(data.totalDurationSec)}
          size="hero"
        />
        <StatCard
          label="Cost / Call"
          value={
            breakdown.costPerCallMicros > 0
              ? formatCostMicros(breakdown.costPerCallMicros)
              : "--"
          }
          sub={`${breakdown.minutes.toFixed(1)} total minutes`}
          size="hero"
        />
        <StatCard
          label="Usage Base"
          value={totalTokens > 0 ? totalTokens.toLocaleString() : "--"}
          sub={`${data.totalTtsChars.toLocaleString()} TTS chars`}
          size="hero"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown</CardTitle>
          <CardDescription>
            Current vendor rates applied to calls in this range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-3 pr-4 font-medium">Line Item</th>
                  <th className="px-4 py-3 font-medium">Rate</th>
                  <th className="px-4 py-3 font-medium">Usage</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {breakdown.items.map((item) => (
                  <tr key={`${item.provider}-${item.category}`}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-foreground">{item.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.provider}
                        {item.model ? ` · ${item.model}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {item.rateLabel}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {formatQuantity(item.quantity, item.unit)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
                      {formatCostMicros(item.costMicros)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
