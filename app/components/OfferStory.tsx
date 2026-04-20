"use client";

import { Check, MessageSquareText, PhoneCall, Building2 } from "lucide-react";

const offers = [
  {
    name: "Start with live patient communication",
    eyebrow: "Acuity Access",
    icon: PhoneCall,
    description:
      "Acuity answers inbound calls, handles routine questions, schedules through your EMR, and routes escalations with context.",
    bullets: [
      "Inbound AI call handling",
      "Scheduling and transfer workflows",
      "After-hours coverage",
      "Phone system foundation",
    ],
  },
  {
    name: "Extend engagement beyond the phone",
    eyebrow: "Acuity Engage",
    icon: MessageSquareText,
    description:
      "Extend that responsiveness into reminders, confirmations, texting, missed-call text back, and follow-up.",
    bullets: [
      "2-way texting and shared inbox",
      "Appointment reminders and confirmations",
      "Missed-call text back",
      "Follow-up and recall paths",
    ],
  },
  {
    name: "Scale across locations and workflows",
    eyebrow: "Enterprise / Multi-Location",
    icon: Building2,
    description:
      "For larger groups, Acuity supports more complex routing, multi-location implementation, and reporting.",
    bullets: [
      "Multi-location implementation",
      "Advanced routing logic",
      "Operational reporting",
      "Productized add-ons and scoped custom work",
    ],
  },
];

export default function OfferStory() {
  return (
    <section className="py-20 md:py-28 bg-background" id="offers">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20 items-start">
          <div className="max-w-3xl">
            <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
              The offer story
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight">
              Start at the front desk. Extend engagement from there.
            </h2>
            <p className="mt-4 text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Acuity starts with live patient communication, then extends into reminders, texting, routing, scheduling, and follow-up.
            </p>

            <div className="mt-8 rounded-[2rem] border border-neutral-200 bg-[#f7fbfb] p-7">
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                Why this is different
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {[
                  "Built for multi-location ophthalmology scale",
                  "Handles medical and vision insurance complexity",
                  "Supports pediatric workflows",
                  "Books patients in Spanish end to end",
                ].map((item) => (
                  <div key={item} className="rounded-2xl bg-white px-4 py-4 text-sm text-muted-foreground border border-neutral-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-1">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              The progression
            </p>
            <div className="mt-5 space-y-4">
              {[
                "Make the practice reachable.",
                "Extend that responsiveness beyond the call.",
                "Scale it across locations and workflows.",
              ].map((item, index) => (
                <div key={item} className="flex items-start gap-4">
                  <div className="h-8 w-8 rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 mt-12">
          {offers.slice(0, 2).map(({ eyebrow, name, description, bullets, icon: Icon }) => (
            <div
              key={eyebrow}
              className="rounded-[2rem] bg-white p-8 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <p className="text-xs font-medium uppercase tracking-widest text-accent">
                  {eyebrow}
                </p>
              </div>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight">{name}</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{description}</p>
              <div className="mt-6 space-y-3">
                {bullets.map((item) => (
                  <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-[2.25rem] bg-[#f7fbfb] p-8 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-[0.7fr_1.3fr] gap-8 items-start">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                {offers[2].eyebrow}
              </p>
              <h3 className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight">
                {offers[2].name}
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {offers[2].description}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {offers[2].bullets.map((item) => (
                <div key={item} className="rounded-2xl bg-white px-5 py-4 text-sm text-muted-foreground">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 p-1 md:p-2">
          <p className="text-xs font-medium uppercase tracking-widest text-accent">
            How pricing works
          </p>
          <h3 className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight">
            Pricing is structured around implementation, platform value, and usage.
          </h3>
          <div className="mt-6 grid gap-6 md:grid-cols-3 text-sm text-muted-foreground">
            <div>
              <p className="font-semibold text-neutral-900">Implementation</p>
              <p className="mt-2 leading-relaxed">
                Covers onboarding, workflow setup, integrations, routing, and go-live.
              </p>
            </div>
            <div>
              <p className="font-semibold text-neutral-900">Monthly platform fee</p>
              <p className="mt-2 leading-relaxed">
                Reflects the software, support, reporting, maintenance, and workflow value.
              </p>
            </div>
            <div>
              <p className="font-semibold text-neutral-900">Usage</p>
              <p className="mt-2 leading-relaxed">
                Covers AI voice minutes, text volume, telephony overages, and optional modules.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
