"use client";

import Image from "next/image";
import { ArrowRight, CheckCircle2, Clock3, PhoneCall, Users } from "lucide-react";

const outcomes = [
  {
    metric: "24/7",
    title: "Coverage beyond desk hours",
    description: "Patients can still reach the practice when the front desk is unavailable.",
    icon: PhoneCall,
  },
  {
    metric: "65%",
    title: "Calls handled end-to-end",
    description: "The majority of repetitive phone work can stay off the front desk in current deployments.",
    icon: Users,
  },
  {
    metric: "36 hrs",
    title: "Monthly staff capacity returned",
    description: "At the benchmark site volume, practices can reclaim meaningful operational time each month.",
    icon: Clock3,
  },
];

const measures = [
  "Missed calls reduced and after-hours demand captured",
  "Booking and confirmation workflows completed without voicemail friction",
  "Staff time returned to higher-value patient work",
  "Escalations transferred with context instead of repeated patient explanations",
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

const logos = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg" },
  { name: "Abita Eye Group", logo: "/logo-abita.png" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg" },
];

export default function ProofNarrative() {
  return (
    <section className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
            What changes
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight">
            Better patient engagement shows up as faster response, calmer operations, and fewer dropped opportunities.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mt-12">
          {outcomes.map(({ metric, title, description, icon: Icon }) => (
            <div key={title} className="rounded-3xl border border-neutral-200 bg-muted/30 p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <p className="text-3xl font-semibold tracking-tight">{metric}</p>
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] mt-12">
          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 md:p-10">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              What operators measure
            </p>
            <div className="mt-6 space-y-4">
              {measures.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl bg-neutral-50 p-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                These are the first numbers the site should prove with harder case-study evidence over time.
                The current benchmarks create a clear framework; the next phase is turning them into
                named deployment proof.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 md:p-10">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Selected customer feedback
            </p>
            <div className="mt-6 space-y-6">
              {feedback.map(({ quote, author, role }) => (
                <div key={`${author}-${role}`} className="rounded-2xl bg-neutral-50 p-6">
                  <blockquote className="text-lg font-medium leading-relaxed text-foreground">
                    &ldquo;{quote}&rdquo;
                  </blockquote>
                  <div className="mt-5">
                    <p className="text-sm font-semibold text-neutral-900">{author}</p>
                    <p className="text-sm text-muted-foreground">{role}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 border-t border-neutral-200 pt-6">
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                {logos.map((logo) => (
                  <div key={logo.name} className="relative mx-auto h-10 w-28">
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
        </div>

        <div className="mt-12 max-w-3xl">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
            <span>
              The strongest long-term upgrade to this section is a real case study with before-and-after
              metrics, screenshots, and 30 / 60 / 90 day results.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
