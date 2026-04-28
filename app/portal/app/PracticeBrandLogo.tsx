import Image from "next/image";

import { hasPracticeLogo, type PracticeBranding } from "@/lib/practice-branding";
import { cn } from "@/lib/utils";

export function PracticeBrandLogo({
  branding,
  className,
  practiceName,
  variant = "header",
}: {
  branding: PracticeBranding;
  className?: string;
  practiceName: string;
  variant?: "header" | "mark";
}) {
  if (!hasPracticeLogo(branding)) {
    return null;
  }

  const imageUrl =
    variant === "mark" ? branding.markUrl || branding.logoUrl : branding.logoUrl;

  if (!imageUrl) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center overflow-hidden rounded-md border border-black/8 bg-white",
        variant === "mark" ? "h-11 w-11 justify-center p-1.5" : "h-14 w-fit px-3 py-2",
        className,
      )}
      style={
        branding.primaryColor ? { borderColor: `${branding.primaryColor}24` } : undefined
      }
    >
      <Image
        alt={branding.logoAlt || `${practiceName} logo`}
        className={cn(
          "object-contain",
          variant === "mark" ? "h-full w-full" : "h-full w-auto max-w-48",
        )}
        height={variant === "mark" ? 44 : 56}
        priority={variant === "header"}
        src={imageUrl}
        width={variant === "mark" ? 44 : 194}
      />
    </div>
  );
}
