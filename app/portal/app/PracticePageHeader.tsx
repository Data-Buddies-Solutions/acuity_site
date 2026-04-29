import type { ReactNode } from "react";

import { PracticeBrandLogo } from "@/app/portal/app/PracticeBrandLogo";
import type { PracticeBranding } from "@/lib/practice-branding";

export function PracticePageHeader({
  children,
  eyebrow,
  logoMeta,
  practiceName,
  title,
  branding,
}: {
  branding: PracticeBranding;
  children?: ReactNode;
  eyebrow?: string;
  logoMeta?: string;
  practiceName: string;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <PracticeBrandLogo
            branding={branding}
            className="h-16 max-w-full"
            practiceName={practiceName}
          />
        </div>
        <div className="min-w-0 sm:row-start-1 sm:col-start-2">
          {eyebrow ? (
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[#10272c] md:text-4xl">
            {title}
          </h1>
        </div>
        {logoMeta ? (
          <p className="text-sm font-medium text-[#617477] sm:col-start-1 sm:row-start-2">
            {logoMeta}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
