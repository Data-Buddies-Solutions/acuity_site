import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb, ArrowRight, CalendarDays, Clock } from "lucide-react";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import BookCallButton from "@/app/components/BookCallButton";
import { Button } from "@/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";
import { insightPosts } from "./posts";

export const metadata: Metadata = {
  title: "Insights — AI Receptionist for Ophthalmology",
  description:
    "Practical writing on AI receptionists, after-hours call capture, EMR booking, and the cost of missed calls in ophthalmology practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/insights`,
  },
};

export default function InsightsPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Insights", url: "/insights" },
        ]}
      />
      <section className="bg-background py-20 md:py-28">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/8 px-3 py-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-medium uppercase tracking-widest text-accent">
              Insights
            </span>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
            How leading ophthalmology practices stop missing calls.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            Practical writing on AI receptionists, after-hours call capture, EMR booking,
            and the real cost of missed calls in ophthalmology and optometry.
          </p>
        </div>
      </section>

      <section className="border-y border-neutral-100 bg-muted/40 py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-8 md:grid-cols-2">
            {insightPosts.map(({ slug, title, description, readingTime, date, tags }) => (
              <div
                key={slug}
                className="rounded-[2rem] border border-neutral-200 bg-white p-8 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-wide text-foreground/50">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    {new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {readingTime}
                  </span>
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <Button
                  asChild
                  variant="secondary"
                  className="mt-8 rounded-full border border-neutral-300 bg-white px-6 py-3 text-neutral-800 shadow-sm"
                >
                  <Link href={`/insights/${slug}`}>
                    Read insight
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-[2rem] border border-neutral-200 bg-white p-8 text-center md:p-12">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Want to see how these ideas map to your practice?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
              The best way to evaluate Acuity is to compare your current responsiveness,
              call patterns, and front-desk load against a real workflow design.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                variant="secondary"
                className="rounded-full border border-neutral-300 bg-white px-7 py-3 text-neutral-800 shadow-sm"
              >
                <Link href="/#results">
                  See proof on the homepage
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
