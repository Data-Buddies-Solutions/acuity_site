import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const toneClassName = {
  accent:
    "border-[var(--portal-border)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]",
  neutral: "border-[var(--portal-border)] bg-white text-[var(--portal-muted)]",
  soft: "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]",
};

export function PortalBadge({
  className,
  tone = "neutral",
  ...props
}: Omit<BadgeProps, "variant"> & {
  tone?: keyof typeof toneClassName;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold leading-none",
        toneClassName[tone],
        className,
      )}
      {...props}
    />
  );
}
