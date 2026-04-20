"use client";

import BookCallButton from "./BookCallButton";
import { Button } from "./ui/button";
import Link from "next/link";
import Image from "next/image";

const partners = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg" },
  { name: "ElevenLabs", logo: "/logo-elevenlabs.png" },
  { name: "Abita Eye Group", logo: "/logo-abita.png" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg" },
  { name: "OnlineDoctorNote", logo: "/logo-onlinedoctornote.png" },
];

const duplicatedPartners = [...partners, ...partners];

const heroBullets = [
  "AI receptionist books and confirms appointments",
  "Insurance checks and intake",
  "Two-way texting and reminders",
  "Smart routing and transfers",
];

const proofStats = [
  ["0", "missed calls in the first 30 days"],
  ["500+", "appointments booked in the first 30 days"],
  ["2,000+", "after-hours calls answered"],
  ["6", "ophthalmology locations supported"],
];

export default function Hero() {
  return (
    <section className="relative pt-6 md:pt-20 lg:pt-24 pb-10 md:pb-20 bg-background overflow-hidden" id="top">
      {/* Main hero: two-column */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-16 items-center">
          {/* Left: Copy */}
          <div>
            <div className="hidden lg:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/8 border border-accent/15 mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="text-xs font-medium text-accent">Built for ophthalmology workflows</span>
            </div>

            <h1 className="mx-auto max-w-[15ch] text-[1.75rem] md:max-w-[16ch] md:text-5xl font-semibold tracking-[-0.04em] leading-[1.02] md:leading-[1.05] mb-4 md:mb-5 text-center lg:hidden [text-wrap:balance]">
              The <span className="text-accent">patient engagement</span> platform for ophthalmology practices.
            </h1>

            <h1 className="hidden lg:block text-[3rem] font-semibold tracking-[-0.04em] leading-[0.98] mb-5 text-left">
              <span className="block">
                The <span className="text-accent">patient engagement</span>
              </span>
              <span className="block">platform for</span>
              <span className="block">ophthalmology practices.</span>
            </h1>

            <p className="text-sm md:text-lg text-muted-foreground max-w-lg leading-relaxed mb-6 md:mb-8 text-center lg:text-left mx-auto lg:mx-0">
              Answer every patient call, reduce front-desk overload, and keep scheduling, reminders, and follow-up moving across your practice.
            </p>

            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 mb-6 text-sm text-neutral-900">
              {heroBullets.map((item) => (
                <span key={item} className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {item}
                </span>
              ))}
            </div>

            {/* Mobile: Hero image between subtitle and buttons */}
            <div className="flex justify-center lg:hidden mb-6">
              <Image
                src="/hero-phone-v4.png"
                alt="AI phone receptionist active call screen"
                width={420}
                height={840}
                sizes="(max-width: 768px) 350px, 420px"
                className="w-[350px] md:w-[420px] h-auto"
                priority
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 sm:gap-4">
              <BookCallButton
                size="default"
                className="text-sm md:text-base px-6 md:px-7 py-3 rounded-full hover:opacity-90 transition-opacity w-full sm:w-auto"
                iconVariant="none"
              >
                Book a Demo
              </BookCallButton>
              <Button
                variant="secondary"
                size="default"
                className="text-sm md:text-base px-6 md:px-7 py-3 rounded-full border border-neutral-300 bg-white text-neutral-800 shadow-sm hover:bg-neutral-50 transition-colors w-full sm:w-auto"
                asChild
              >
                <Link href="/#offers">See how it works</Link>
              </Button>
            </div>

            <div className="mt-6 max-w-2xl rounded-[1.75rem] border border-neutral-200 bg-[#f7fbfb] px-5 py-5 text-center lg:text-left">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
                6-location ophthalmology deployment
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                {proofStats.map(([value, label]) => (
                  <div key={label} className="min-w-0">
                    <p className="text-lg font-semibold text-neutral-900 md:text-xl">{value}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Trust signals — hidden on mobile */}
            <div className="hidden md:flex items-center lg:justify-start gap-4 mt-8 pt-8 border-t border-neutral-100">
              <Image
                src="/hipaa-badge.webp"
                alt="HIPAA Compliant"
                width={72}
                height={32}
                className="opacity-60"
              />
              <div className="w-px h-6 bg-neutral-200" />
              <p className="text-xs text-muted-foreground">
                HIPAA compliant &middot; EMR-integrated &middot; Built for ophthalmology workflows
              </p>
            </div>
          </div>

          {/* Desktop: Image on right */}
          <div className="hidden lg:flex justify-center items-center overflow-visible">
            <Image
              src="/hero-phone-v4.png"
              alt="AI phone receptionist active call screen"
              width={760}
              height={1520}
              sizes="760px"
              className="w-[760px] h-auto max-w-none drop-shadow-[0_24px_60px_rgba(0,0,0,0.10)]"
              priority
            />
          </div>
        </div>
      </div>

      {/* Logo Marquee */}
      <div className="mt-14 md:mt-20 relative z-10">
        <div className="py-6 md:py-8 overflow-hidden border-t border-neutral-100">
          <div className="mx-auto max-w-6xl px-4 md:px-6 mb-4 md:mb-6">
            <p className="text-center text-xs text-muted-foreground/60 uppercase tracking-widest font-medium">
              Trusted by eye care practices and technology partners
            </p>
          </div>
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-20 md:w-40 bg-gradient-to-r from-background to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-20 md:w-40 bg-gradient-to-l from-background to-transparent z-10" />

            <div className="logo-carousel flex items-center gap-10 md:gap-20 animate-scroll">
              {duplicatedPartners.map((partner, index) => (
                <div
                  key={`${partner.name}-${index}`}
                  className="logo-carousel-item flex-shrink-0 flex items-center justify-center"
                >
                  <div className="w-28 h-10 md:w-40 md:h-12 relative flex items-center justify-center">
                    <Image
                      src={partner.logo}
                      alt={partner.name}
                      fill
                      className="object-contain grayscale opacity-35 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-scroll {
          animation: scroll 25s linear infinite;
        }
        @media (min-width: 768px) {
          .animate-scroll {
            animation: scroll 35s linear infinite;
          }
        }
        .logo-carousel:hover .logo-carousel-item {
          opacity: 0.4;
          transition: opacity 0.15s ease;
        }
        .logo-carousel:hover .logo-carousel-item:hover {
          opacity: 1;
        }
        .animate-scroll:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
}
