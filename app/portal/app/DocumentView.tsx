import Link from "next/link";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DocumentPageHeader({
  actionHref,
  actionLabel = "Edit document",
  description,
  eyebrow,
  title,
}: Readonly<{
  actionHref?: string;
  actionLabel?: string;
  description: string;
  eyebrow: string;
  title: string;
}>) {
  return (
    <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
          {eyebrow}
        </p>
        <h2 className="text-3xl font-semibold tracking-normal text-[var(--portal-ink)]">
          {title}
        </h2>
        <p className="max-w-3xl text-base leading-relaxed text-[var(--portal-muted)]">
          {description}
        </p>
      </div>

      {actionHref ? (
        <Button asChild variant="secondary">
          <Link href={actionHref}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {actionLabel}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

export function DocumentPanel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <article className="overflow-hidden rounded-xl border border-[var(--portal-border-strong)] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.05)]">
      {children}
    </article>
  );
}

export function DocumentSection({
  children,
  description,
  title,
}: Readonly<{
  children: ReactNode;
  description?: string;
  title: string;
}>) {
  return (
    <section className="border-t border-black/6 px-5 py-5 first:border-t-0 md:px-7 md:py-6">
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <h3 className="text-sm font-semibold tracking-normal text-[var(--portal-ink)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-[var(--portal-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

export function DocumentText({
  empty = "Not provided yet.",
  value,
}: Readonly<{
  empty?: string;
  value?: string;
}>) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return <p className="text-sm italic text-[var(--portal-muted-soft)]">{empty}</p>;
  }

  return (
    <p className="whitespace-pre-line text-sm leading-7 text-[var(--portal-ink-soft)]">
      {normalizedValue}
    </p>
  );
}

export function DetailGrid({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function DetailItem({
  label,
  value,
}: Readonly<{
  label: string;
  value?: string | number;
}>) {
  const normalizedValue = typeof value === "number" ? String(value) : value?.trim();

  return (
    <div className="min-w-0 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold leading-6 text-[var(--portal-ink)]">
        {normalizedValue || "Not provided"}
      </p>
    </div>
  );
}
