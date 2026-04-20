"use client";

import { Check, MessageSquareText, PhoneCall, Building2 } from "lucide-react";

const offers = [
  {
    name: "Start with live patient communication",
    eyebrow: "Acuity Access",
    icon: PhoneCall,
    description:
      "Acuity answers inbound calls, handles routine patient questions, schedules through your EMR, and routes escalations with context so the front desk is not buried in repetitive work.",
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
      "Once the front door is working, Acuity extends the same responsiveness into reminders, confirmations, texting, missed-call text back, and follow-up communication.",
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
      "For larger groups, Acuity supports more complex routing, multi-location implementation, reporting, and communication design without turning into a custom-services business.",
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
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
            The story
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight">
            Patient engagement starts with how reachable, responsive, and organized the practice feels.
          </h2>
          <p className="mt-4 text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl">
            Acuity is built to improve patient engagement first at the front desk, then across reminders,
            texting, routing, scheduling, and follow-up. The point is not more channels. The point is a
            practice that feels easier to reach and easier to trust.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 mt-12">
          {offers.map(({ eyebrow, name, description, bullets, icon: Icon }) => (
            <div
              key={eyebrow}
              className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm"
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

        <div className="mt-10 rounded-[2rem] border border-neutral-200 bg-muted/40 p-8 md:p-10">
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
