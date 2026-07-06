"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

  const label = copied ? "Copied" : "Copy";
  const Icon = copied ? Check : Copy;

  return (
    <>
      <Tooltip label={label}>
        <Button
          aria-label={label}
          title={label}
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className={cn("size-8 text-muted-foreground hover:text-foreground", className)}
        >
          <Icon aria-hidden="true" />
        </Button>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
