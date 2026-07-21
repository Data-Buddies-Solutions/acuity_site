import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";

type BookCallButtonProps = {
  variant?: "default" | "secondary";
  size?: "default" | "lg" | "sm";
  iconVariant?: "arrow-right" | "arrow-up-right" | "none";
  className?: string;
  children?: React.ReactNode;
};

export default function BookCallButton({
  variant = "default",
  size = "lg",
  iconVariant = "arrow-right",
  className,
  children = "Book a strategy call",
}: BookCallButtonProps) {
  const Icon = iconVariant === "arrow-up-right" ? ArrowUpRight : ArrowRight;

  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={SITE_CONFIG.calendarLink} target="_blank" rel="noopener noreferrer">
        {children}
        {iconVariant !== "none" && <Icon aria-hidden="true" className="h-4 w-4" />}
      </Link>
    </Button>
  );
}
