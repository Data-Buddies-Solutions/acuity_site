"use client";

import { useEffect, useState, type MouseEvent } from "react";

export function CopyButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`text-xs text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
