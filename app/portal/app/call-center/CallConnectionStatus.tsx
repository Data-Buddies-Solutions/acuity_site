import { PortalBadge } from "@/app/portal/app/PortalBadge";

import type { MediaConnectionState } from "./softphone-media-adapter";

export function CallConnectionStatus({
  connectionState,
  restoring = false,
}: {
  connectionState: MediaConnectionState;
  restoring?: boolean;
}) {
  const connected = !restoring && connectionState === "READY";
  const connecting = !restoring && connectionState === "CONNECTING";

  return (
    <PortalBadge
      className={
        restoring
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : connected
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]"
      }
      role="status"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          restoring ? "bg-amber-500" : connected ? "bg-emerald-500" : "bg-slate-400"
        }`}
      />
      {restoring
        ? "Restoring calling…"
        : connected
          ? "Connected"
          : connecting
            ? "Phone connecting…"
            : "Phone disconnected — reconnecting"}
    </PortalBadge>
  );
}
