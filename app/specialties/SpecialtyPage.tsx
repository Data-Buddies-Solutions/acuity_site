import Link from "next/link";
import { PhoneCall } from "lucide-react";

import BookCallButton from "@/app/components/BookCallButton";
import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import { SITE_CONFIG } from "@/lib/config";

import type { SpecialtyPageContent } from "./pages";

type SpecialtyPageProps = {
  page: SpecialtyPageContent;
};

export default function SpecialtyPage({ page }: SpecialtyPageProps) {
  const canonical = `${SITE_CONFIG.baseUrl}/${page.slug}`;
  const webPageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
    description: page.description,
    url: canonical,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.baseUrl,
    },
  };

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: page.navLabel, url: `/${page.slug}` },
        ]}
      />
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }}
        type="application/ld+json"
      />
      <article className="bg-[#fbfaf7]">
        {/* Hero — home-page scale, but leads with the specialty's own pain */}
        <section className="relative overflow-hidden pb-16 pt-20 md:pb-20 md:pt-28">
          <div className="mx-auto flex max-w-6xl flex-col items-center px-4 text-center md:px-6">
            <span className="marketing-label inline-flex items-center gap-2 rounded-[6px] border border-[#e1e5eb] bg-white px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#586372] shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {page.eyebrow}
            </span>
            <h1 className="mt-8 max-w-5xl text-balance text-[2.7rem] leading-[1.02] text-[#101820] antialiased subpixel-antialiased sm:text-[3.4rem] md:text-[3.9rem] lg:text-[4.4rem]">
              {page.h1}
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-[16px] leading-[1.58] text-[#586372] md:text-[1.12rem] lg:mt-6 lg:text-[1.18rem]">
              {page.intro}
            </p>
            <div className="mt-6 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:gap-4 md:mt-7 lg:mt-8">
              <Link
                className="marketing-cta inline-flex h-12 w-full items-center justify-center gap-2 rounded-[4px] bg-[#172033] px-5 text-[12px] font-medium tracking-[0.11em] text-white shadow-[0_18px_42px_rgba(23,32,51,0.18)] transition-colors hover:bg-[#22304a] sm:w-auto md:px-6"
                href="tel:+14843989071"
              >
                <PhoneCall className="h-4 w-4" />
                Try the AI Receptionist
              </Link>
              <BookCallButton
                className="marketing-cta w-full rounded-[4px] border border-[#d4dae3] bg-white px-5 py-3 text-[12px] font-medium tracking-[0.11em] text-[#172033] shadow-sm transition-colors hover:border-[#bdc7d7] hover:bg-[#f7f8fb] sm:w-auto md:px-6"
                iconVariant="none"
                size="default"
                variant="secondary"
              >
                {page.primaryCta}
              </BookCallButton>
            </div>
          </div>
        </section>

        {/* Why Acuity — editorial two-column, matching the home page's quieter sections */}
        <section className="border-y border-[#e1e5eb] bg-white py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
              <div>
                <p className="mb-4 text-xs font-medium uppercase tracking-widest text-accent">
                  Why Acuity
                </p>
                <h2 className="text-3xl font-semibold leading-[1.15] tracking-tight md:text-4xl">
                  {page.capabilitiesHeading}
                </h2>
              </div>
              <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
                {page.capabilities.map(({ title, body }) => (
                  <div className="border-t border-[#d9dfe8] pt-5" key={title}>
                    <h3 className="text-lg font-semibold tracking-tight text-[#101820]">
                      {title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#586372]">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="bg-[#edf1f7] py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-[#101820] md:text-4xl lg:text-5xl">
              {page.closingHeading}
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[#586372]">
              {page.closingBody}
            </p>
            <div className="mt-9">
              <BookCallButton
                className="marketing-cta rounded-[4px] bg-[#172033] px-8 text-[12px] font-medium tracking-[0.11em] text-white shadow-[0_18px_42px_rgba(23,32,51,0.18)] hover:bg-[#22304a]"
                iconVariant="arrow-right"
                size="lg"
              >
                {page.primaryCta}
              </BookCallButton>
            </div>
          </div>
        </section>
      </article>
    </>
  );
}
