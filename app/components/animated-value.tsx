"use client";

import { useEffect, useRef, useState } from "react";

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function parseValue(str: string): {
  prefix: string;
  number: number;
  decimals: number;
  suffix: string;
  useLocale: boolean;
} | null {
  if (str === "--" || str === "N/A") return null;

  const match = str.match(/^([^0-9-]*?)([\d,]+(?:\.\d+)?)(.*?)$/);
  if (!match) return null;

  const prefix = match[1];
  const raw = match[2];
  const suffix = match[3];
  const number = parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;

  const dotIdx = raw.indexOf(".");
  const decimals = dotIdx >= 0 ? raw.length - dotIdx - 1 : 0;
  const useLocale = raw.includes(",");

  return { prefix, number, decimals, suffix, useLocale };
}

function formatAnimatedNumber(n: number, decimals: number, useLocale: boolean): string {
  if (useLocale) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return n.toFixed(decimals);
}

const DURATION = 800;

export function AnimatedValue({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const parsed = parseValue(value);

    if (!parsed) {
      prevRef.current = null;
      rafRef.current = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(rafRef.current);
    }

    const from = prevRef.current ?? 0;
    const to = parsed.number;
    prevRef.current = to;

    if (from === to) {
      rafRef.current = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(rafRef.current);
    }

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      const eased = easeOutExpo(progress);
      const current = from + (to - from) * eased;
      const formatted = `${parsed!.prefix}${formatAnimatedNumber(current, parsed!.decimals, parsed!.useLocale)}${parsed!.suffix}`;
      setDisplay(formatted);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span className={className}>{display}</span>;
}
