"use client";

import { useCallback, useState } from "react";

import type { PortalCallActivityItem } from "@/lib/call-center";

import ActivityRail from "./ActivityRail";
import SoftphonePanel from "./SoftphonePanel";

export default function CallCenterWorkspace({
  activity,
  configured,
  enabled,
  outboundCallerNumber,
}: {
  activity: PortalCallActivityItem[];
  configured: boolean;
  enabled: boolean;
  outboundCallerNumber: string;
}) {
  const [seed, setSeed] = useState<{ value: string; token: number } | null>(null);

  const handleCallback = useCallback((number: string) => {
    setSeed({ token: Date.now(), value: number });
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ActivityRail activity={activity} onCallback={handleCallback} />
      </div>
      <div>
        {enabled && configured ? (
          <SoftphonePanel
            callerNumber={outboundCallerNumber}
            enabled={enabled}
            seedNumber={seed}
          />
        ) : (
          <section className="rounded-xl border border-black/6 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
              Softphone standby
            </h3>
            <p className="mt-2 text-sm text-[#617477]">
              {enabled
                ? "Telnyx is missing connection details. Add the connection ID, credential ID, and caller number to start placing calls."
                : "Enable the call center to start placing and receiving calls in the browser."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
