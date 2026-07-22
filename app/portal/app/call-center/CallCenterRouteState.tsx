"use client";

import { Headphones } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CallConnectionStatus } from "./CallConnectionStatus";
import { useSoftphoneRuntime } from "./softphone-runtime-context";

export function CallCenterRouteState({
  busy = false,
  message,
  retry,
  title,
}: {
  busy?: boolean;
  message: string;
  retry?: () => void;
  title: string;
}) {
  const runtime = useSoftphoneRuntime();

  return (
    <section
      aria-busy={busy}
      aria-live="polite"
      className="mx-auto flex min-h-[28rem] max-w-3xl items-center justify-center"
      role={busy ? "status" : "alert"}
    >
      <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border border-[var(--portal-border)] bg-white px-6 py-10 text-center shadow-sm">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--portal-panel-soft)] text-[var(--portal-accent)]">
          <Headphones className="size-5" aria-hidden="true" />
        </div>
        <CallConnectionStatus connectionState={runtime.media.connection} />
        <div>
          <h1 className="text-lg font-semibold text-[var(--portal-ink)]">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--portal-muted)]">
            {message}
          </p>
        </div>
        {retry ? (
          <Button autoFocus onClick={retry} variant="secondary">
            Retry
          </Button>
        ) : null}
      </div>
    </section>
  );
}
