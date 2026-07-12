"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PortalSelect } from "@/app/portal/app/PortalFields";

import { useCallCenterCurrentCallGuard } from "./call-center-current-call-guard";

export function QueuePicker({
  currentId,
  office,
  queues,
}: {
  currentId: string;
  office: string | null;
  queues: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const currentCallGuarded = useCallCenterCurrentCallGuard();

  return (
    <label className="inline-flex w-full sm:w-fit">
      <span className="sr-only">Queue</span>
      <PortalSelect
        aria-label="Queue"
        className="sm:min-w-56"
        disabled={pending || currentCallGuarded}
        onChange={(event) => {
          const params = new URLSearchParams({ queue: event.target.value });
          if (office) params.set("office", office);
          startTransition(() => {
            router.push(`/portal/app/call-center?${params.toString()}`);
          });
        }}
        value={currentId}
      >
        {queues.map((queue) => (
          <option key={queue.id} value={queue.id}>
            {queue.name}
          </option>
        ))}
      </PortalSelect>
    </label>
  );
}
