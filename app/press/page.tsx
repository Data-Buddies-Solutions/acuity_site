import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Newspaper } from "lucide-react";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import BookCallButton from "@/app/components/BookCallButton";
import { Button } from "@/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";
import { pressReleases } from "./posts";

export const metadata: Metadata = {
  title: "Press & News — AI Receptionist for Ophthalmology",
  description:
    "Press releases and company news from Acuity Health. Latest on our AI receptionist for ophthalmology, AdvancedMD partnership, and product launches.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/press`,
  },
};

export default function PressPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Press", url: "/press" },
        ]}
      />

      <section className="bg-background pt-10 pb-10 md:pt-14 md:pb-12">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/8 px-3 py-1.5">
            <Newspaper className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-medium uppercase tracking-widest text-accent">
              Press
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
            Acuity Health in the news.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Announcements, launches, and milestones from the team building the AI
            receptionist for ophthalmology.
          </p>
        </div>
      </section>

      <section className="bg-muted/40 pt-10 pb-16 md:pt-12 md:pb-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="space-y-6">
            {pressReleases.map((release) => (
              <article
                key={release.slug}
                className="rounded-[2rem] border border-neutral-200 bg-white p-8 shadow-sm md:p-10"
              >
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-foreground/50">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {release.dateline}
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
                  {release.headline}
                </h2>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                  {release.summary}
                </p>
                <Button
                  asChild
                  variant="secondary"
                  className="mt-6 rounded-full border border-neutral-300 bg-white px-6 py-3 text-neutral-800 shadow-sm"
                >
                  <Link href={`/press/${release.slug}`}>
                    Read release
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </article>
            ))}
          </div>

          <div className="mt-12 rounded-[2rem] border border-neutral-200 bg-white p-8 text-center md:p-12">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Press inquiries
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              For media, partnerships, or briefings — reach out directly.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                variant="secondary"
                className="rounded-full border border-neutral-300 bg-white px-7 py-3 text-neutral-800 shadow-sm"
              >
                <Link href={`mailto:${SITE_CONFIG.email}`}>
                  Contact press
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <BookCallButton
                size="default"
                className="rounded-full px-7 py-3"
                iconVariant="none"
              >
                Book a Demo
              </BookCallButton>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
