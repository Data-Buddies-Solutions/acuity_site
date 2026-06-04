import type { ReactNode } from "react";

import { PracticeBrandLogo } from "@/app/portal/app/PracticeBrandLogo";
import type { PracticeBranding } from "@/lib/practice-branding";

export function PracticePageHeader({
  children,
  eyebrow,
  logoMeta,
  practiceName,
  showLogo = true,
  title,
  branding,
}: {
  branding: PracticeBranding;
  children?: ReactNode;
  eyebrow?: string;
  logoMeta?: string;
  practiceName: string;
  showLogo?: boolean;
  title: string;
}) {
  if (!showLogo) {
    return (
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-sm font-medium tracking-normal text-[#7b8494]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="break-words text-4xl font-semibold leading-tight tracking-normal text-[#151a24] md:text-5xl">
            {title}
          </h1>
          {logoMeta ? (
            <p className="mt-2 text-sm font-medium text-[#8a94a6]">{logoMeta}</p>
          ) : null}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
          <div className="min-w-0">
            <PracticeBrandLogo
              branding={branding}
              className="h-12 max-w-[220px] border-transparent bg-transparent px-0 py-0 shadow-none"
              practiceName={practiceName}
            />
          </div>
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-sm font-medium tracking-normal text-[#7b8494]">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="break-words text-4xl font-semibold leading-tight tracking-normal text-[#151a24] md:text-5xl">
              {title}
            </h1>
          </div>
        </div>
        {logoMeta ? (
          <p className="mt-3 text-sm font-medium text-[#8a94a6]">{logoMeta}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
