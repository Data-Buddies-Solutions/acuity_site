import Link from "next/link";
import { ArrowRight, Check, PhoneCall } from "lucide-react";

import BookCallButton from "@/app/components/BookCallButton";
import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import { SITE_CONFIG } from "@/lib/config";

import type { SolutionPageContent } from "./pages";

type SolutionPageProps = {
  page: SolutionPageContent;
};

export default function SolutionPage({ page }: SolutionPageProps) {
  const canonical = `${SITE_CONFIG.baseUrl}/${page.slug}`;
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
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
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        type="application/ld+json"
      />
      <article className="bg-[#fbfaf7]">
        <Hero page={page} />
        <ProofStrip items={page.proof} />
        <Workflow page={page} />
        <Capabilities page={page} />
        <Comparison page={page} />
        <FaqPreview page={page} />
        <FinalCta page={page} />
      </article>
    </>
  );
}

function Hero({ page }: SolutionPageProps) {
  return (
    <section className="relative overflow-hidden bg-[#fbfaf7] pb-16 pt-16 md:pb-24 md:pt-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 md:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="max-w-3xl">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
            Acuity Health
          </p>
          <h1 className="mt-5 max-w-4xl text-[3rem] leading-[0.95] text-[#101820] sm:text-[4rem] md:text-[5rem] lg:text-[5.7rem]">
            {page.h1}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-[1.7] text-[#586372] md:text-lg">
            {page.intro}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <BookCallButton
              className="marketing-cta rounded-[4px] bg-[#172033] px-5 text-[12px] font-medium tracking-[0.11em] text-white shadow-[0_18px_42px_rgba(23,32,51,0.18)] hover:bg-[#22304a]"
              iconVariant="arrow-right"
              size="lg"
            >
              {page.primaryCta}
            </BookCallButton>
            {page.secondaryCta ? (
              <Link
                className="marketing-cta inline-flex h-12 items-center justify-center gap-2 rounded-[4px] border border-[#d4dae3] bg-white px-5 text-[12px] font-medium tracking-[0.11em] text-[#172033] shadow-sm transition-colors hover:bg-[#f7f8fb]"
                href={page.secondaryCta.href}
              >
                {page.secondaryCta.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="relative">
          <div className="absolute inset-x-8 top-8 h-48 rounded-full bg-[#dfe7f3] blur-3xl" />
          <div className="relative overflow-hidden rounded-[8px] border border-[#d9dfe8] bg-white shadow-[0_30px_90px_rgba(23,32,51,0.10)]">
            <div className="border-b border-[#e1e5eb] bg-[#f7f8fb] px-5 py-4">
              <div className="flex items-center justify-between">
                <p className="marketing-label text-[10px] font-medium tracking-[0.16em] text-[#586372]">
                  Live call workflow
                </p>
                <span className="h-2 w-2 rounded-full bg-[#4f9f7a]" />
              </div>
            </div>
            <div className="space-y-5 p-5 md:p-6">
              <div className="flex gap-3">
                <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] bg-[#172033] text-white">
                  <PhoneCall className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-[#101820]">
                    Patient request captured
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[#586372]">
                    Intent, office, urgency, and next step are structured before the call
                    is completed or handed off.
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {["Scheduling", "Insurance", "Language", "Escalation"].map((label) => (
                  <div
                    className="flex items-center gap-2 rounded-[4px] border border-[#e1e5eb] bg-[#fbfaf7] px-3 py-2 text-sm text-[#172033]"
                    key={label}
                  >
                    <Check className="h-3.5 w-3.5 text-accent" />
                    {label}
                  </div>
                ))}
              </div>
              <div className="rounded-[4px] bg-[#111827] p-5 text-white">
                <p className="marketing-label text-[10px] font-medium tracking-[0.16em] text-[#aebbd0]">
                  Handoff summary
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[#d8dee8]">
                  Clear reason, configured route, patient need, and staff action surface
                  in one place.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProofStrip({ items }: { items: string[] }) {
  return (
    <section className="border-y border-[#e1e5eb] bg-white">
      <div className="mx-auto grid max-w-7xl gap-px px-4 md:grid-cols-3 md:px-6">
        {items.map((item) => (
          <div className="py-5 md:px-8 md:py-7" key={item}>
            <p className="text-sm font-medium tracking-tight text-[#172033]">{item}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Workflow({ page }: SolutionPageProps) {
  return (
    <section className="bg-white py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="max-w-3xl">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
            Workflow
          </p>
          <h2 className="mt-4 text-4xl leading-[1.05] md:text-5xl">
            A better front door for patient calls.
          </h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {page.workflow.map((step, index) => (
            <div className="border-t border-[#d9dfe8] pt-5 md:pr-10" key={step.title}>
              <span className="marketing-label text-[11px] font-medium tracking-[0.16em] text-[#8a94a6]">
                0{index + 1}
              </span>
              <h3 className="mt-5 text-2xl text-[#101820]">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#586372]">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Capabilities({ page }: SolutionPageProps) {
  return (
    <section className="bg-[#edf1f7] py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
              Why it converts
            </p>
            <h2 className="mt-4 text-4xl leading-[1.05] md:text-5xl">
              Specific enough for the calls eye care teams actually receive.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {page.sections.map((section) => (
              <div className="border-t border-[#cfd7e4] pt-5" key={section.title}>
                <h3 className="text-2xl text-[#101820]">{section.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#586372]">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Comparison({ page }: SolutionPageProps) {
  return (
    <section className="bg-white py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
            Compare
          </p>
          <h2 className="mt-4 text-4xl leading-[1.05] md:text-5xl">
            Built to complete the next step, not just answer the phone.
          </h2>
        </div>
        <div className="mt-12 overflow-hidden rounded-[8px] border border-[#d9dfe8]">
          <div className="grid grid-cols-2 border-b border-[#d9dfe8] bg-[#f7f8fb]">
            <p className="marketing-label px-4 py-3 text-[10px] font-medium tracking-[0.14em] text-[#586372] md:px-6">
              Traditional coverage
            </p>
            <p className="marketing-label border-l border-[#d9dfe8] px-4 py-3 text-[10px] font-medium tracking-[0.14em] text-[#586372] md:px-6">
              Acuity
            </p>
          </div>
          {page.comparison.map((row) => (
            <div
              className="grid grid-cols-1 border-b border-[#e1e5eb] last:border-b-0 md:grid-cols-2"
              key={row.traditional}
            >
              <p className="px-4 py-5 text-sm leading-relaxed text-[#586372] md:px-6">
                {row.traditional}
              </p>
              <p className="border-t border-[#e1e5eb] px-4 py-5 text-sm leading-relaxed text-[#172033] md:border-l md:border-t-0 md:px-6">
                {row.acuity}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqPreview({ page }: SolutionPageProps) {
  return (
    <section className="bg-[#fbfaf7] py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 md:px-6 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
            FAQ
          </p>
          <h2 className="mt-4 text-4xl leading-[1.05] md:text-5xl">
            Questions buyers ask.
          </h2>
        </div>
        <div className="space-y-4">
          {page.faqs.map((faq) => (
            <div className="border-t border-[#d9dfe8] pt-5" key={faq.question}>
              <h3 className="text-xl text-[#101820]">{faq.question}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#586372]">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta({ page }: SolutionPageProps) {
  return (
    <section className="bg-[#111827] py-20 text-white md:py-28">
      <div className="mx-auto max-w-4xl px-4 text-center md:px-6">
        <h2 className="text-4xl leading-[1.05] text-white md:text-6xl">
          See how Acuity would handle your real calls.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#d8dee8]">
          Book a workflow review. We will map Acuity to your appointment types, insurance
          rules, locations, languages, and transfer policy.
        </p>
        <div className="mt-9">
          <BookCallButton
            className="marketing-cta rounded-[4px] bg-white px-8 text-[12px] font-medium tracking-[0.11em] text-[#111827] shadow-[0_18px_45px_rgba(0,0,0,0.18)] hover:bg-[#f7f8fb]"
            iconVariant="arrow-right"
            size="lg"
          >
            {page.primaryCta}
          </BookCallButton>
        </div>
      </div>
    </section>
  );
}
