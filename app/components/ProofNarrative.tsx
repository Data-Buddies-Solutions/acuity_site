"use client";

import Image from "next/image";
import { Check, Clock3, Languages, PhoneCall, ShieldCheck, Users } from "lucide-react";

const outcomes = [
  {
    metric: "0",
    label: "missed calls",
    detail: "in the first 30 days",
    icon: PhoneCall,
  },
  {
    metric: "2,000+",
    label: "after-hours calls answered",
    detail: "captured instead of voicemail",
    icon: Users,
  },
  {
    metric: "400",
    label: "staff hours returned",
    detail: "back to the team",
    icon: Clock3,
  },
  {
    metric: "500+",
    label: "appointments booked",
    detail: "in the first 30 days",
    icon: Check,
  },
];

const proofPoints = [
  {
    title: "Insurance complexity handled",
    text: "Supports both medical and vision insurance workflows across the practice.",
    icon: ShieldCheck,
  },
  {
    title: "Spanish-language booking supported",
    text: "Patients can be answered and booked in Spanish without a separate manual process.",
    icon: Languages,
  },
  {
    title: "100+ concurrent calls handled",
    text: "High-volume patient communication can be managed without dropped demand.",
    icon: Users,
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
    <section className="py-20 md:py-28 bg-white" id="results">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
            Proof from practice
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[3rem] font-semibold tracking-tight leading-[1.05]">
            Real proof from a 6-location ophthalmology deployment.
          </h2>
          <p className="mt-5 max-w-2xl text-base md:text-lg leading-relaxed text-muted-foreground">
            Acuity is already being used in a complex ophthalmology environment with
            pediatric workflows, insurance complexity, multilingual communication, and
            high-volume call demand.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {outcomes.map(({ metric, label, detail, icon: Icon }) => (
            <div
              key={label}
              className="rounded-[1.8rem] border border-neutral-200 bg-[#f7fbfb] p-7"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <p className="text-3xl font-semibold tracking-tight text-neutral-900">
                  {metric}
                </p>
              </div>
              <p className="mt-5 text-base font-semibold text-neutral-900">{label}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {detail}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] items-start">
          <div className="rounded-[2rem] border border-neutral-200 bg-white p-8 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Deployment snapshot
            </p>
            <h3 className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
              One ophthalmology group. Six locations. High-volume patient communication.
            </h3>
            <p className="mt-4 text-sm md:text-base leading-relaxed text-muted-foreground">
              This deployment includes pediatric workflows, medical and vision insurance,
              Spanish language support, and after-hours demand across a multi-location
              ophthalmology environment.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {proofPoints.map(({ title, text, icon: Icon }) => (
                <div key={title} className="rounded-[1.5rem] bg-[#f7fbfb] p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
                      <Icon className="h-4.5 w-4.5 text-accent" />
                    </div>
                    <p className="text-sm font-semibold text-neutral-900">{title}</p>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-neutral-200 bg-[#f7fbfb] p-8 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Customer feedback
            </p>
            <blockquote className="mt-5 text-xl font-medium leading-relaxed text-foreground">
              &ldquo;I was spending 4+ hours a day on manual admin work. Acuity Health
              gave me my life back. I can finally focus on what matters.&rdquo;
            </blockquote>
            <div className="mt-5">
              <p className="text-sm font-semibold text-neutral-900">Jason Buchwald</p>
              <p className="text-sm text-muted-foreground">Practice Operator</p>
            </div>

            <div className="mt-8 border-t border-neutral-200 pt-6">
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                Trusted by eye care practices
              </p>
              <div className="mt-5 grid grid-cols-2 gap-6">
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
      </div>
    </section>
  );
}
