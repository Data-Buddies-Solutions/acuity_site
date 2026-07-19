"use client";

import { CallCenterRouteState } from "./CallCenterRouteState";

export default function CallCenterError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <CallCenterRouteState
      message="The live workspace could not render. The phone runtime remains mounted while you retry this workspace."
      retry={reset}
      title="Call Center workspace unavailable"
    />
  );
}
