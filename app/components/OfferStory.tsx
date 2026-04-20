"use client";

import { Building2, Check, MessageSquareText, PhoneCall } from "lucide-react";

const products = [
  {
    name: "Acuity Access",
    title: "Start with an AI receptionist built for ophthalmology.",
    description:
      "Acuity Access answers every call, handles high-volume front-desk workflows, and keeps scheduling moving through your EMR without adding more phone burden to the team.",
    icon: PhoneCall,
    accentClass: "bg-white",
    bullets: [
      "AI receptionist answers inbound calls",
      "Language support for multilingual patient communication",
      "Books, confirms, cancels, and reschedules appointments",
      "Insurance eligibility, intake, and insurance-related call handling",
      "Concurrent-call support, after-hours coverage, and transfers with context",
    ],
  },
  {
    name: "Acuity Engage",
    title: "Extend engagement beyond the call.",
    description:
      "Acuity Engage keeps patient communication moving after the first conversation with reminders, confirmations, follow-up, and two-way texting.",
    icon: MessageSquareText,
    accentClass: "bg-[#f7fbfb]",
    bullets: [
      "Two-way texting and shared inbox workflows",
      "Appointment reminders and confirmations",
      "Missed-call text back and patient follow-up",
      "Recall and reactivation paths across the practice",
    ],
  },
  {
    name: "Enterprise / Multi-Location",
    title: "Scale across locations, routing, and reporting.",
    description:
      "For larger practices and groups, Acuity adds more advanced routing, cross-location workflows, and operational visibility without changing the core system.",
    icon: Building2,
    accentClass: "bg-white",
    bullets: [
      "Multi-location implementation and rollout",
      "Advanced routing and escalation logic",
      "Analytics and reporting across the front desk",
      "Productized add-ons and scoped workflow expansion",
    ],
  },
];

export default function OfferStory() {
  return (
    <section className="py-20 md:py-28 bg-background" id="offers">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
            The platform
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[3rem] font-semibold tracking-tight leading-[1.05]">
            One platform for patient communication and front-desk workflows.
          </h2>
          <p className="mt-5 max-w-2xl text-base md:text-lg leading-relaxed text-muted-foreground">
            Acuity brings AI call handling, scheduling workflows, reminders, two-way texting, and
            analytics into one system built for ophthalmology practices.
          </p>
        </div>

        <div className="mt-12 grid gap-6 xl:grid-cols-3">
          {products.map(({ name, title, description, bullets, icon: Icon, accentClass }) => (
            <div
              key={name}
              className={`rounded-[2rem] border border-neutral-200 p-7 shadow-sm ${accentClass}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <p className="text-xs font-medium uppercase tracking-widest text-accent">{name}</p>
              </div>

              <h3 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">{title}</h3>
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
      </div>
    </section>
  );
}
