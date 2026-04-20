"use client";

import { Building2, Languages, ShieldCheck, Stethoscope } from "lucide-react";

const pillars = [
  {
    icon: Building2,
    title: "Multi-location ophthalmology scale",
    description:
      "Acuity is already supporting a 6-location ophthalmology environment with high-volume patient communication across the group.",
  },
  {
    icon: ShieldCheck,
    title: "Medical + vision insurance complexity",
    description:
      "Scheduling and engagement workflows are built to support both medical and vision insurance conversations, not just generic booking flows.",
  },
  {
    icon: Stethoscope,
    title: "Pediatric and specialty workflows",
    description:
      "Acuity is designed for the routing, escalation, and appointment nuance that come with real eye-care specialty operations.",
  },
  {
    icon: Languages,
    title: "Spanish-language booking end-to-end",
    description:
      "Patients can be fully answered and booked in Spanish, making engagement more responsive for multilingual patient populations.",
  },
];

export default function Differentiation() {
  return (
    <section className="py-20 md:py-28 bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
            Why Acuity feels different
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight">
            Built for ophthalmology communication complexity, not generic patient messaging.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mt-12">
          {pillars.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10">
                <Icon className="h-5 w-5 text-accent" />
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
