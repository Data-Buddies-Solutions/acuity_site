"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

import BookCallButton from "@/app/components/BookCallButton";
import { Button } from "@/app/components/ui/button";

const VALUE_PROPS = [
  {
    eyebrow: "Built for AdvancedMD",
    title: "Native scheduling, two-way.",
    body: "Acuity reads your AdvancedMD providers, locations, visit types, and rules in real time, then writes appointments back the moment a patient confirms. No middle-of-the-night reconciliation, no double-booking.",
  },
  {
    eyebrow: "Tuned for eye care",
    title: "Ophthalmology-grade triage.",
    body: "Trained on medical vs. vision insurance, pediatric flow, urgent visit routing, and the dozen other things that make ophthalmology phones harder than a generic AI can handle.",
  },
  {
    eyebrow: "Listed on the marketplace",
    title: "A verified AdvancedMD integration.",
    body: "Acuity is an official AdvancedMD Marketplace partner. Practices already on AdvancedMD can plug in Acuity without changing their scheduling backbone or retraining the front desk on a new tool.",
  },
];

const STATS = [
  { value: "100%", label: "Of inbound calls answered" },
  { value: "2 min", label: "Avg. time to book in AdvancedMD" },
  { value: "24/7", label: "After-hours patient capture" },
  { value: "4 weeks", label: "Typical time to go live" },
];

export default function AdvancedMdLanding() {
  return (
    <>
      <HeroSection />
      <PartnershipStrip />
      <ValueSection />
      <FinalCta />
    </>
  );
}

/* ─────────────────── Hero ─────────────────── */

function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white pt-24 md:pt-28 lg:pt-32">
      <div className="relative z-10 mx-auto max-w-5xl px-4 text-center md:px-6">
        {/* Announcement chip */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-700 shadow-sm backdrop-blur"
          initial={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.5 }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          New partnership · Announced May 2026
        </motion.div>

        {/* Logo lockup */}
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto mt-10 flex items-center justify-center gap-6 md:gap-10"
          initial={{ opacity: 0, scale: 0.96 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <AcuityWordmark />
          <span className="text-2xl font-light text-neutral-300 md:text-3xl">×</span>
          <div className="relative h-8 w-32 md:h-10 md:w-44">
            <Image
              alt="AdvancedMD"
              className="object-contain"
              fill
              priority
              sizes="(max-width: 768px) 128px, 176px"
              src="/logo-advancedmd.png"
            />
          </div>
        </motion.div>

        <motion.h1
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-10 max-w-[18ch] text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-neutral-900 md:text-6xl lg:text-[4.5rem] [text-wrap:balance]"
          initial={{ opacity: 0, y: 12 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          The AI receptionist,{" "}
          <span className="text-accent">now native to AdvancedMD.</span>
        </motion.h1>

        <motion.p
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
          initial={{ opacity: 0, y: 12 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          Acuity is officially listed on the AdvancedMD Marketplace as the AI receptionist
          purpose-built for ophthalmology. Answer every call, book directly into
          AdvancedMD, and capture the after-hours demand your front desk has been missing.
        </motion.p>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
          initial={{ opacity: 0, y: 12 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <BookCallButton
            className="w-full rounded-full bg-neutral-900 px-8 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(0,0,0,0.15)] transition-opacity hover:opacity-90 sm:w-auto md:text-base"
            iconVariant="arrow-right"
            size="lg"
          >
            Book an AdvancedMD demo
          </BookCallButton>
          <Button
            asChild
            className="w-full rounded-full border border-neutral-300 bg-white px-7 py-3 text-sm text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 sm:w-auto md:text-base"
            size="lg"
            variant="secondary"
          >
            <a
              href="https://www.advancedmd.com/integrations/marketplace/acuity-health/"
              rel="noopener noreferrer"
              target="_blank"
            >
              View on AdvancedMD Marketplace
            </a>
          </Button>
        </motion.div>

        {/* Stat strip */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 md:mt-24 md:grid-cols-4"
          initial={{ opacity: 0, y: 16 }}
          transition={{ delay: 0.55, duration: 0.6 }}
        >
          {STATS.map((s) => (
            <div className="bg-white px-5 py-6 text-left md:px-6 md:py-7" key={s.label}>
              <p className="text-[1.65rem] font-semibold tracking-tight text-neutral-900 md:text-4xl">
                {s.value}
              </p>
              <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] leading-[1.4] text-muted-foreground md:text-[11px] md:tracking-[0.16em]">
                {s.label}
              </p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Trusted-by marquee */}
      <div className="relative z-10 mt-20 pb-4 md:mt-28 md:pb-6">
        <div className="overflow-hidden border-t border-neutral-100 py-6 md:py-8">
          <div className="mx-auto mb-4 max-w-6xl px-4 md:mb-6 md:px-6">
            <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
              Trusted by eye care practices
            </p>
          </div>
          <div className="relative">
            <div className="absolute bottom-0 left-0 top-0 z-10 w-20 bg-gradient-to-r from-background to-transparent md:w-40" />
            <div className="absolute bottom-0 right-0 top-0 z-10 w-20 bg-gradient-to-l from-background to-transparent md:w-40" />

            <div className="logo-carousel flex animate-scroll-partners items-center gap-10 md:gap-20">
              {DUPLICATED_PARTNERS.map((partner, index) => (
                <div
                  className="logo-carousel-item flex flex-shrink-0 items-center justify-center"
                  key={`${partner.name}-${index}`}
                >
                  <div className="relative flex h-10 w-28 items-center justify-center md:h-12 md:w-40">
                    <Image
                      alt={partner.name}
                      className="object-contain opacity-35 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0"
                      fill
                      sizes="(max-width: 768px) 112px, 160px"
                      src={partner.logo}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll-partners {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll-partners {
          animation: scroll-partners 25s linear infinite;
        }
        @media (min-width: 768px) {
          .animate-scroll-partners {
            animation: scroll-partners 35s linear infinite;
          }
        }
        .logo-carousel:hover .logo-carousel-item {
          opacity: 0.4;
          transition: opacity 0.15s ease;
        }
        .logo-carousel:hover .logo-carousel-item:hover {
          opacity: 1;
        }
        .animate-scroll-partners:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
}

const PARTNERS = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg" },
  { name: "Abita Eye Group", logo: "/logo-abita.png" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg" },
  { name: "OnlineDoctorNote", logo: "/logo-onlinedoctornote.png" },
];

const DUPLICATED_PARTNERS = [...PARTNERS, ...PARTNERS];

function AcuityWordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg fill="none" height="32" viewBox="0 0 100 100" width="32">
        <circle cx="50" cy="15" fill="#1a1a1a" r="11" />
        <circle cx="20" cy="35" fill="#1a1a1a" r="11" />
        <circle cx="80" cy="35" fill="#1a1a1a" r="11" />
        <circle cx="50" cy="50" fill="#1a1a1a" r="11" />
        <circle cx="20" cy="65" fill="#1a1a1a" r="11" />
        <circle cx="80" cy="65" fill="#1a1a1a" r="11" />
        <circle cx="50" cy="85" fill="#1a1a1a" r="11" />
      </svg>
      <span className="text-xl font-semibold tracking-tight text-neutral-900 md:text-2xl">
        Acuity
      </span>
    </div>
  );
}

/* ─────────────────── Partnership Strip ─────────────────── */

function PartnershipStrip() {
  return (
    <section className="border-y border-neutral-100 bg-[#f7fbfb] py-10 md:py-14">
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Acuity is an official AdvancedMD Marketplace partner
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-lg leading-relaxed text-neutral-700 md:text-xl [text-wrap:balance]">
          Your AdvancedMD instance is the source of truth. Acuity plugs in, reading
          providers, locations, visit types, and scheduling rules, and operates as a 24/7
          front desk on top of the system your team already knows.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────── Value Props ─────────────────── */

function ValueSection() {
  return (
    <section className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
            Why this partnership matters
          </p>
          <h2 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.02em] md:text-5xl lg:text-[3.25rem] [text-wrap:balance]">
            AdvancedMD runs the practice.
            <br />
            Acuity runs the phones.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Most AI receptionists treat your EHR like an afterthought. Acuity is built
            around AdvancedMD, so what happens on the call lands in the chart.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
          {VALUE_PROPS.map((v, i) => (
            <motion.div
              className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-[0_18px_45px_rgba(15,39,44,0.05)]"
              initial={{ opacity: 0, y: 16 }}
              key={v.title}
              transition={{ delay: i * 0.08, duration: 0.5, ease: "easeOut" }}
              viewport={{ amount: 0.3, once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-accent">
                {v.eyebrow}
              </p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight text-neutral-900 md:text-[1.4rem]">
                {v.title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                {v.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Final CTA ─────────────────── */

function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[#111827] py-24 text-white md:py-32">
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#aebbd0]">
          Already on AdvancedMD?
        </p>
        <h2 className="mx-auto mt-5 max-w-[20ch] text-4xl font-semibold leading-[1.0] tracking-[-0.03em] text-white md:text-6xl lg:text-[4.25rem] [text-wrap:balance]">
          See Acuity run on your AdvancedMD instance.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
          30-minute demo. We walk through your AdvancedMD scheduling rules, insurance
          flow, and call mix, and show you the AI receptionist live.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4">
          <BookCallButton
            className="rounded-full bg-white px-8 py-3 text-base font-semibold text-[#111827] shadow-[0_18px_45px_rgba(0,0,0,0.18)] transition-opacity hover:opacity-90"
            iconVariant="arrow-right"
            size="lg"
          >
            Book a Demo
          </BookCallButton>
          <Link
            className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/75 underline-offset-4 hover:underline"
            href="/"
          >
            Or explore the full Acuity platform →
          </Link>
        </div>
      </div>
    </section>
  );
}
