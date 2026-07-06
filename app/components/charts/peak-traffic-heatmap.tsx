"use client";

import { Fragment } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function intensity(count: number, max: number): string {
  if (max === 0 || count === 0) return "bg-muted/40 text-muted-foreground";
  const ratio = count / max;
  if (ratio > 0.75) return "bg-foreground text-background";
  if (ratio > 0.5) return "bg-foreground/70 text-background";
  if (ratio > 0.25) return "bg-muted-foreground/35 text-foreground";
  return "bg-muted text-muted-foreground";
}

export function PeakTrafficHeatmap({
  data,
}: {
  data: { day: string; hour: number; count: number }[];
}) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const max = Math.max(...data.map((d) => d.count), 0);

  const lookup = new Map<string, number>();
  for (const d of data) {
    lookup.set(`${d.day}-${d.hour}`, d.count);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peak Traffic</CardTitle>
        <CardDescription>Call volume by day and hour in ET</CardDescription>
      </CardHeader>
      <CardContent>
        {max === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="inline-grid gap-[2px]"
              style={{ gridTemplateColumns: `auto repeat(${hours.length}, 1fr)` }}
            >
              <div />
              {hours.map((h) => (
                <div
                  key={h}
                  className="px-1 pb-1 text-center text-[9px] font-medium text-muted-foreground"
                >
                  {formatHour(h)}
                </div>
              ))}

              {days.map((day) => (
                <Fragment key={day}>
                  <div className="flex items-center pr-2 text-[10px] font-medium text-muted-foreground">
                    {day}
                  </div>
                  {hours.map((hour) => {
                    const count = lookup.get(`${day}-${hour}`) ?? 0;
                    return (
                      <div
                        key={`${day}-${hour}`}
                        className={`flex h-6 min-w-6 items-center justify-center rounded text-[9px] font-medium tabular-nums transition-colors ${intensity(count, max)}`}
                        title={`${day} ${formatHour(hour)}: ${count} call${count !== 1 ? "s" : ""}`}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
