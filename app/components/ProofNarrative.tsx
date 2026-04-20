"use client";

import Image from "next/image";
import { ArrowRight, CheckCircle2, Clock3, PhoneCall, Users, ShieldCheck, CalendarCheck2, Languages } from "lucide-react";

const outcomes = [
  {
    metric: "0",
    title: "Missed calls",
    description: "In the first 30 days, the deployment reported zero missed calls.",
    icon: PhoneCall,
  },
  {
    metric: "2,000+",
    title: "After-hours calls answered",
    description: "In the first 30 days, after-hours demand was answered instead of dropping into voicemail.",
    icon: Users,
  },
  {
    metric: "400",
    title: "Staff hours returned",
    description: "In the first 30 days, staff time was returned instead of disappearing into repetitive phone work.",
    icon: Clock3,
  },
  {
    metric: "500+",
    title: "Appointments booked",
    description: "In the first 30 days, Acuity booked 500+ appointments at scale.",
    icon: CalendarCheck2,
  },
];

const measures = [
  "100+ concurrent calls handled",
  "Supports medical and vision insurance workflows",
  "Supports pediatric ophthalmology workflows",
  "Fully answers and books in Spanish",
  "Filters robocalls before they reach staff",
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
    <section className="py-20 md:py-32 bg-white relative overflow-hidden" id="results">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="max-w-3xl relative z-10">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
            Proof in practice
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[3.15rem] font-semibold tracking-tight leading-[1.04]">
            Better patient engagement shows up as faster response, calmer operations, and fewer dropped opportunities.
          </h2>
          <p className="mt-5 max-w-2xl text-base md:text-lg leading-relaxed text-muted-foreground">
            In one 6-location ophthalmology deployment, the first 30 days already showed what responsive patient engagement can look like at scale.
          </p>
        </div>

        <div className="mt-12 rounded-[2.5rem] bg-white p-8 md:p-14 shadow-[0_24px_80px_rgba(13,115,119,0.12)] relative z-10">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                Featured deployment spotlight
              </p>
              <h3 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                A 6-location ophthalmology practice is using Acuity to stay responsive at scale.
              </h3>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Pediatric doctors. Medical and vision insurance. Spanish-language booking. 100+ concurrent calls. In the first 30 days, Acuity handled the front desk across all six locations and captured after-hours demand.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: ShieldCheck,
                    title: "Insurance complexity handled",
                    text: "Supports both medical and vision insurance workflows across the practice.",
                  },
                  {
                    icon: Languages,
                    title: "Fully answers and books in Spanish",
                    text: "Spanish-speaking patients can be handled end-to-end without a separate manual process.",
                  },
                ].map(({ icon: Icon, title, text }) => (
                  <div key={title} className="rounded-2xl bg-[#f8fcfc] p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
                        <Icon className="h-4.5 w-4.5 text-accent" />
                      </div>
                      <p className="text-sm font-semibold text-neutral-900">{title}</p>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.9rem] bg-[#f7fbfb] p-6 md:p-8">
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                Why this matters
              </p>
              <div className="mt-5 space-y-4">
                {[
                  "Multi-location complexity proved out quickly.",
                  "High-volume patient communication can be handled without missed calls.",
                  "After-hours demand does not need to fall into voicemail.",
                  "Patient engagement can hold across insurance, language, and pediatric workflow complexity.",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl bg-white p-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This is what responsive patient engagement looked like in the first 30 days of a real ophthalmology deployment.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-4 mt-12 relative z-10">
          {outcomes.map(({ metric, title, description, icon: Icon }) => (
            <div key={title} className="rounded-[1.8rem] bg-white p-8 shadow-sm">
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

        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] mt-12 relative z-10">
          <div className="rounded-[2rem] bg-white p-8 md:p-10 shadow-sm">
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
            <div className="mt-8 rounded-2xl bg-[#f7fbfb] p-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                These are the operational details behind the first 30 days of results.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] bg-white p-8 md:p-10 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Selected customer feedback
            </p>
            <div className="mt-6 space-y-6">
              {feedback.map(({ quote, author, role }) => (
                <div key={`${author}-${role}`} className="rounded-2xl bg-[#f8fcfc] p-6">
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

        <div className="mt-14 max-w-4xl relative z-10">
          <div className="rounded-[2rem] bg-white px-6 py-6 md:px-8 md:py-7 shadow-sm">
            <div className="flex items-start gap-3 text-sm md:text-base text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
              <span>
                Acuity works best when patient engagement is defined operationally: every call answered, the right patient booked, the right language supported.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
