import Link from "next/link";

import { cn } from "@/lib/utils";

type PortalDocumentSelectorItem = {
  id: string;
  label: string;
  slug: string;
};

export function PortalDocumentSelector({
  ariaLabel,
  basePath,
  items,
  queryKey,
  selectedId,
}: Readonly<{
  ariaLabel: string;
  basePath: string;
  items: PortalDocumentSelectorItem[];
  queryKey: string;
  selectedId: string;
}>) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
        Location
      </p>
      <nav aria-label={ariaLabel} className="flex gap-2 overflow-x-auto">
        {items.map((item) => (
          <Link
            key={item.id}
            aria-current={item.id === selectedId ? "page" : undefined}
            className={cn(
              "min-w-fit rounded-lg border px-3 py-2 text-sm font-medium transition",
              item.id === selectedId
                ? "border-[var(--portal-border)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                : "border-[var(--portal-border)] bg-white text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
            )}
            href={`${basePath}?${queryKey}=${encodeURIComponent(item.slug)}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
