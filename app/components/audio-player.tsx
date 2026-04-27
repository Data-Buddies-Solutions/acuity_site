"use client";

import { useEffect, useState } from "react";

export function AudioPlayer({ callId }: { callId: string }) {
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const src = `/api/admin/calls/${callId}/audio`;

  useEffect(() => {
    fetch(src, { method: "HEAD" })
      .then((response) => setHasAudio(response.ok))
      .catch(() => setHasAudio(false));
  }, [src]);

  if (hasAudio !== true) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-foreground">Call Recording</h2>
      <div className="rounded-xl border border-white/60 bg-white/50 p-4 backdrop-blur-lg">
        <audio controls preload="metadata" className="w-full" src={src} />
      </div>
    </section>
  );
}
