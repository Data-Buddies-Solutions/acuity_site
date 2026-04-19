import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CheckCircle2, Clock3, PhoneCall, ShieldCheck, Users } from "lucide-react";

import BookCallButton from "@/app/components/BookCallButton";
import Results from "@/app/components/Results";
import { Button } from "@/app/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";

const outcomeCards = [
  {
    metric: "24/7",
    title: "Patient access coverage",
    description:
      "Acuity answers when the front desk cannot, including evenings, weekends, and overflow periods.",
    icon: PhoneCall,
  },
  {
    metric: "65%",
    title: "Calls handled end-to-end",
    description:
      "Current deployments show the majority of repetitive phone work can stay off the front desk without leaving patients stranded.",
    icon: Users,
  },
  {
    metric: "36 hrs",
    title: "Monthly staff capacity returned",
    description:
      "Using the current site benchmark of 50 daily calls, practices can reclaim meaningful time for in-office care and escalations.",
    icon: Clock3,
  },
];

const proofPoints = [
  "Built for ophthalmology and optometry workflows",
  "EMR scheduling and escalation logic",
  "70+ language support",
  "HIPAA-conscious implementation",
  "Phone system, AI receptionist, and text workflows under one platform",
];

const feedback = [
  {
    quote:
      "Acuity Health handles our phones now and gave hours back to our staff every week. We're booking more patients with less manual work.",
    author: "Dr. Shechtman",
    role: "North Miami Beach Eye Center",
  },
  {
    quote:
      "I was spending 4+ hours a day on manual admin work. Acuity Health gave me my life back. I can finally focus on what matters.",
    author: "Jason Buchwald",
    role: "Practice Operator",
  },
];

const operatorsMeasure = [
  "Missed calls reduced and after-hours demand captured",
  "Staff time returned to higher-value patient work",
  "Booking and confirmation workflows completed without voicemail friction",
  "Escalations transferred with context instead of repeated patient explanations",
];

const logos = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg" },
  { name: "Abita Eye Group", logo: "/logo-abita.png" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg" },
];

export const metadata: Metadata = {
  title: "Results",
  description:
    "See how Acuity Health frames outcomes for patient access, front-desk relief, and patient engagement in eye care practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/results`,
  },
};

export default function ResultsPage() {
  return (
    <>
      <section className="bg-background pt-20 md:pt-28 pb-16 md:pb-20">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-accent">Results</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
            Proof that better patient access changes the operating reality of a practice.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            Acuity is designed to protect demand, return staff capacity, and create a more
            responsive patient experience across calls, scheduling, reminders, routing, and
            follow-up.
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
              <Link href="/platform">See the Platform</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y border-neutral-100 bg-muted/40 py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {outcomeCards.map(({ metric, title, description, icon: Icon }) => (
              <div key={title} className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <p className="text-3xl font-semibold tracking-tight">{metric}</p>
                </div>
                <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Results />

      <section className="bg-background py-20 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 md:p-10">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-accent" />
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                What buyers should believe
              </p>
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              Results depend on a system that patients can actually use.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Eye care practices do not need abstract AI. They need a communication layer that
              answers the phone, completes routine work reliably, and keeps staff focused on the
              moments where a human matters.
            </p>
            <div className="mt-8 space-y-4">
              {proofPoints.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 md:p-10">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              What operators measure
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              The first 90 days should show operational change.
            </h2>
            <div className="mt-8 space-y-4">
              {operatorsMeasure.map((item) => (
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
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Selected customer feedback
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              The strongest proof is operational relief.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {feedback.map(({ quote, author, role }) => (
              <div key={`${author}-${role}`} className="rounded-3xl border border-neutral-200 bg-white p-8">
                <blockquote className="text-xl font-medium leading-relaxed text-foreground">
                  &ldquo;{quote}&rdquo;
                </blockquote>
                <div className="mt-8">
                  <p className="text-sm font-semibold text-neutral-900">{author}</p>
                  <p className="text-sm text-muted-foreground">{role}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-14 border-t border-neutral-200 pt-10">
            <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground/70">
              Teams and practices in the Acuity orbit
            </p>
            <div className="mt-8 grid grid-cols-2 gap-8 md:grid-cols-4">
              {logos.map((logo) => (
                <div key={logo.name} className="relative mx-auto h-12 w-36">
                  <Image
                    src={logo.logo}
                    alt={logo.name}
                    fill
                    className="object-contain grayscale opacity-60"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-100 bg-background py-20 md:py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Want the numbers mapped to your own call volume?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            We&apos;ll walk through your call patterns, patient workflows, location count, and
            engagement needs, then show what Acuity Access and Acuity Engage should look like for
            your practice.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <BookCallButton size="lg" className="rounded-full px-8 py-3" iconVariant="arrow-right">
              Book a Demo
            </BookCallButton>
            <Button asChild variant="ghost" className="rounded-full px-6 py-3">
              <Link href="/platform">Review packages</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
