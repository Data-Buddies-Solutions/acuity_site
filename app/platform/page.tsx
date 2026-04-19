import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, PhoneCall, MessageSquareText, Building2, Sparkles } from "lucide-react";

import BookCallButton from "@/app/components/BookCallButton";
import { Button } from "@/app/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";

const coreOffers = [
  {
    name: "Acuity Access",
    icon: PhoneCall,
    description:
      "Answer every patient call, reduce front-desk overload, and modernize the front door of the practice.",
    bestFor: "Best for practices that need better call capture, scheduling, routing, and after-hours coverage.",
    includes: [
      "AI receptionist for inbound patient calls",
      "FAQ handling and transfer workflows",
      "EMR scheduling and escalation logic",
      "Acuity Voice phone system foundation",
      "After-hours coverage and whisper",
    ],
    pricing: [
      "Implementation starts at $10,000 for 1 location",
      "Monthly platform fee + AI usage pricing",
      "$0.21 per AI minute",
    ],
  },
  {
    name: "Acuity Engage",
    icon: MessageSquareText,
    description:
      "Keep patients informed, responsive, and on schedule through texting, reminders, and follow-up workflows.",
    bestFor: "Best for practices that want to extend communication beyond the live call.",
    includes: [
      "2-way texting and shared inbox",
      "Appointment reminders and confirmations",
      "Thank-you texts and missed-call text back",
      "Recall and reactivation add-on paths",
      "Text workflow templates by practice type",
    ],
    pricing: [
      "Starter at $199/month for 5,000 texts",
      "Growth at $299/month for 10,000 texts",
      "Pro at $499/month for 20,000 texts",
    ],
  },
  {
    name: "Enterprise / Multi-Location",
    icon: Building2,
    description:
      "For larger organizations that need more locations, more governance, and more advanced routing and workflow control.",
    bestFor: "Best for multi-location groups, complex scheduling environments, and advanced reporting needs.",
    includes: [
      "Tiered implementation for multi-location rollouts",
      "Advanced routing and escalation logic",
      "Deeper reporting and operational controls",
      "Cross-location communication design",
      "Strategic add-on and integration planning",
    ],
    pricing: [
      "2-3 locations: $18,000-$25,000 implementation",
      "4-6 locations: $30,000-$40,000 implementation",
      "Custom monthly pricing based on scope and volume",
    ],
  },
];

const addOns = [
  "Transcripts and call summaries",
  "Call recording",
  "Advanced reporting",
  "Outbound voice",
  "Recall and reactivation campaigns",
  "Extra numbers and advanced triaging",
];

const customWork = [
  "EMR note upload",
  "Custom API actions",
  "Unique integration logic",
  "Highly practice-specific automations",
];

export const metadata: Metadata = {
  title: "Platform and Packages",
  description:
    "Explore Acuity Access, Acuity Engage, and enterprise options for patient access and engagement in ophthalmology and optometry practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/platform`,
  },
};

export default function PlatformPage() {
  return (
    <>
      <section className="bg-background pt-20 md:pt-28 pb-16 md:pb-20">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/8 px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-medium uppercase tracking-widest text-accent">
              Acuity Platform
            </span>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
            One communication layer for calls, texts, scheduling, and follow-up.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            Acuity helps eye care practices answer every patient, reduce front-desk overload,
            and keep patient communication moving across calls, texts, reminders, routing,
            scheduling, and follow-up.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <BookCallButton size="default" className="rounded-full px-7 py-3" iconVariant="none">
              Book a Demo
            </BookCallButton>
            <Button
              asChild
              variant="secondary"
              className="rounded-full border border-neutral-300 bg-white px-7 py-3 text-neutral-800 shadow-sm"
            >
              <Link href="#packages">See Packages</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y border-neutral-100 bg-muted/40 py-12" id="packages">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {coreOffers.map(({ name, icon: Icon, description, bestFor, includes, pricing }) => (
              <div
                key={name}
                className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight">{name}</h2>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{description}</p>
                <p className="mt-4 text-sm font-medium leading-relaxed text-neutral-900">
                  {bestFor}
                </p>

                <div className="mt-6">
                  <p className="text-xs font-medium uppercase tracking-widest text-accent">
                    Includes
                  </p>
                  <div className="mt-3 space-y-3">
                    {includes.map((item) => (
                      <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 border-t border-neutral-100 pt-6">
                  <p className="text-xs font-medium uppercase tracking-widest text-accent">
                    Pricing Approach
                  </p>
                  <div className="mt-3 space-y-3">
                    {pricing.map((item) => (
                      <p key={item} className="text-sm leading-relaxed text-muted-foreground">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background py-20 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-neutral-200 bg-white p-8">
            <h2 className="text-2xl font-semibold tracking-tight">Productized add-ons</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              These are repeatable upgrades that expand platform value and increase monthly
              recurring revenue without turning Acuity into a services business.
            </p>
            <div className="mt-6 space-y-3">
              {addOns.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-8">
            <h2 className="text-2xl font-semibold tracking-tight">Custom work</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Configuration is included in implementation. Custom work is reserved for true
              one-off engineering and should stay rare, scoped, and premium.
            </p>
            <div className="mt-6 space-y-3">
              {customWork.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-muted py-20 md:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 md:p-12">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              How pricing works
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Pricing should reflect software value, not just usage volume.
            </h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl bg-neutral-50 p-6">
                <h3 className="text-lg font-semibold">What is always part of the model</h3>
                <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <p>Implementation fee for onboarding, workflow setup, and go-live.</p>
                  <p>Monthly platform fee for software, support, reporting, and maintenance.</p>
                  <p>Usage-based pricing for AI minutes, texts, and telephony overages.</p>
                </div>
              </div>
              <div className="rounded-2xl bg-neutral-50 p-6">
                <h3 className="text-lg font-semibold">What happens in the sales process</h3>
                <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <p>We tailor the recommendation based on location count, workflow complexity, and call volume.</p>
                  <p>Standard configuration stays inside implementation.</p>
                  <p>Only one-off engineering is scoped as custom work.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-100 bg-background py-20 md:py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Start with Acuity Access. Expand into Acuity Engage.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            The best way to evaluate Acuity is to hear how it would handle your real patient
            workflows, then scope the right package for your practice.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <BookCallButton size="lg" className="rounded-full px-8 py-3" iconVariant="arrow-right">
              Book a Demo
            </BookCallButton>
            <Button asChild variant="ghost" className="rounded-full px-6 py-3">
              <Link href="/faq">Read the FAQ</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
