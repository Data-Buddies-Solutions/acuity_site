import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb, ArrowRight } from "lucide-react";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import BookCallButton from "@/app/components/BookCallButton";
import { Button } from "@/app/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";

export const metadata: Metadata = {
  title: "Insights",
  description:
    "Acuity Health insights on patient access, patient engagement, front-desk operations, and communication strategy for eye care practices.",
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
            A focused library for patient access and engagement in eye care.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            We removed the old general AI topics. This section will only publish material that is
            directly useful to ophthalmology and optometry operators evaluating patient access,
            front-desk design, and patient engagement.
          </p>
        </div>
      </section>

      <section className="border-y border-neutral-100 bg-muted/40 py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 text-center md:p-12">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Coming next
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              We are rebuilding this around operator-relevant topics only.
            </h2>
            <div className="mx-auto mt-8 grid max-w-3xl gap-4 text-left md:grid-cols-2">
              {[
                "The hidden cost of missed calls in ophthalmology",
                "How eye care practices should measure patient access",
                "Front-desk overload: what to fix first",
                "Patient engagement before the visit",
              ].map((topic) => (
                <div key={topic} className="rounded-2xl bg-neutral-50 p-5 text-sm text-muted-foreground">
                  {topic}
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                variant="secondary"
                className="rounded-full border border-neutral-300 bg-white px-7 py-3 text-neutral-800 shadow-sm"
              >
                <Link href="/results">
                  See proof and results
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <BookCallButton size="default" className="rounded-full px-7 py-3" iconVariant="none">
                Book a Demo
              </BookCallButton>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
