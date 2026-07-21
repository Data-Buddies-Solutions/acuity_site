import type { Metadata } from "next";
import Link from "next/link";

import { SITE_CONFIG } from "@/lib/config";

const values = [
  {
    title: "Make the future more human.",
    description:
      "Start every decision with what creates the best experience for the patient.",
  },
  {
    title: "Stay curious.",
    description:
      "Question assumptions, explore the bleeding edge, and turn what is newly possible into customer advantage.",
  },
  {
    title: "Be resilient.",
    description: "Expect the wringer. Adapt, keep moving, and come back sharper.",
  },
  {
    title: "Take ownership.",
    description:
      "If it touches us, we follow it through. Problems do not disappear between people, systems, or excuses.",
  },
] as const;

const differentiators = [
  {
    title: "Move fast.",
    description: "Small teams with less bureaucracy thrive in the age of AI.",
  },
  {
    title: "Built into your workflow.",
    description: "We embed our expertise directly into the way your team works.",
  },
  {
    title: "Direct access to the founders.",
    description: "Work closely with the people building and improving the product.",
  },
] as const;

export const metadata: Metadata = {
  title: "Mission & Values",
  description:
    "Acuity Health's mission and the operating values behind how we build patient access technology for specialty medical practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/values`,
  },
};

export default function ValuesPage() {
  return (
    <>
      <section className="border-b border-[#e1e5eb] bg-canvas">
        <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
          <div className="max-w-6xl">
            <p className="marketing-label text-[11px] font-semibold tracking-[0.2em] text-[#536a91]">
              Our mission
            </p>
            <h1 className="mt-6 max-w-6xl text-[clamp(2.75rem,6vw,5.75rem)] leading-[0.94] text-[#101820]">
              Free medical practices from administrative overload so every patient can be
              treated like a VIP.
            </h1>

            <div className="mt-12 grid gap-5 border-l-2 border-[#536a91] pl-6 md:grid-cols-[0.3fr_1.7fr] md:items-start md:gap-8 md:pl-8">
              <p className="marketing-label pt-1 text-[11px] font-semibold tracking-[0.2em] text-[#536a91]">
                Our vision
              </p>
              <h2 className="max-w-4xl text-[clamp(1.8rem,3.5vw,3.5rem)] leading-[1.05] text-[#344054]">
                A future where AI runs the administration, humans elevate the care, and no
                patient falls through the cracks.
              </h2>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="difference-heading" className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <p className="marketing-label text-[11px] font-semibold tracking-[0.2em] text-[#536a91]">
                What makes Acuity different
              </p>
              <h2
                className="mt-5 max-w-xl text-4xl leading-[1.02] text-[#101820] md:text-5xl lg:text-[3.5rem]"
                id="difference-heading"
              >
                A different way of working together.
              </h2>
            </div>
            <p className="max-w-2xl self-end text-lg leading-8 text-[#586372] lg:pb-1">
              We move quickly, work inside your existing workflow, and keep you close to
              the people shaping the product.
            </p>
          </div>

          <div className="mt-14 grid divide-y divide-[#d9dfe8] border-y border-[#d9dfe8] md:mt-18 md:grid-cols-3 md:divide-x md:divide-y-0">
            {differentiators.map((differentiator) => (
              <article
                className="py-9 md:px-8 md:py-10 first:md:pl-0 last:md:pr-0"
                key={differentiator.title}
              >
                <h3 className="max-w-sm text-2xl leading-tight text-[#101820]">
                  {differentiator.title}
                </h3>
                <p className="mt-4 max-w-sm text-base leading-7 text-[#667085]">
                  {differentiator.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="values-heading" className="bg-canvas py-20 md:py-28">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 lg:grid-cols-[0.7fr_1.6fr] lg:gap-24">
          <div>
            <p className="marketing-label text-[11px] font-semibold tracking-[0.2em] text-[#536a91]">
              How we work
            </p>
            <h2
              className="mt-4 max-w-sm text-4xl leading-[1.02] text-[#101820] md:text-5xl"
              id="values-heading"
            >
              Our values
            </h2>
            <p className="mt-6 max-w-sm text-base leading-7 text-[#667085]">
              Values matter when they guide a hard decision. These are the standards we
              use to decide what to build, how to build it, and what good looks like.
            </p>
          </div>

          <div className="border-t border-[#dfe5ee]">
            {values.map((value) => (
              <article
                className="grid gap-4 border-b border-[#dfe5ee] py-9 md:grid-cols-[0.85fr_1fr] md:gap-12 md:py-11"
                key={value.title}
              >
                <h3 className="text-3xl leading-tight text-[#101820] md:text-4xl">
                  {value.title}
                </h3>
                <p className="max-w-2xl text-base leading-7 text-[#586372] md:pt-1">
                  {value.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#172033] text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 md:grid-cols-[1.35fr_0.65fr] md:items-end md:py-20">
          <div>
            <p className="marketing-label text-[11px] font-semibold tracking-[0.2em] text-[#aebbd0]">
              The company
            </p>
            <h2 className="mt-5 max-w-3xl text-4xl leading-[1.05] text-white md:text-5xl">
              Built by people who stay close to the work.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#c4cddd]">
              Our team brings together healthcare operations, clinical judgment, and
              engineering to build a better front door for specialty care.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 md:justify-end">
            <Link
              className="marketing-cta inline-flex h-11 items-center justify-center rounded-[4px] bg-white px-5 text-xs font-semibold tracking-[0.08em] text-[#172033] hover:bg-[#eef2f7] hover:text-[#172033]"
              href="/about"
            >
              Meet the team
            </Link>
            <a
              className="marketing-cta inline-flex h-11 items-center justify-center rounded-[4px] border border-white/25 px-5 text-xs font-semibold tracking-[0.08em] text-white hover:border-white/50 hover:text-white"
              href={SITE_CONFIG.calendarLink}
              rel="noopener noreferrer"
              target="_blank"
            >
              Talk with us
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
