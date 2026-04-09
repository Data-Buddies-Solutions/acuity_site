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

export default function Hero() {
  return (
    <section className="relative pt-6 md:pt-20 lg:pt-24 pb-8 md:pb-16 bg-background overflow-hidden" id="top">
      {/* Main hero: two-column */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-16 items-center">
          {/* Left: Copy */}
          <div>
            <div className="hidden lg:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/8 border border-accent/15 mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="text-xs font-medium text-accent">Built for ophthalmology & optometry</span>
            </div>

            <h1 className="text-[1.75rem] md:text-5xl lg:text-[3.5rem] font-semibold tracking-[-0.04em] leading-[1.08] mb-4 md:mb-5 text-center lg:text-left">
              Your Patients Call.
              <br />
              <span className="text-accent">Our AI Answers.</span>
            </h1>

            <p className="text-sm md:text-lg text-muted-foreground max-w-lg leading-relaxed mb-6 md:mb-8 text-center lg:text-left mx-auto lg:mx-0">
              The AI phone receptionist that handles scheduling, insurance checks, and appointment confirmations. Everything syncs to your EMR. No hold time. No missed calls. 24/7.
            </p>

            {/* Mobile: Hero image between subtitle and buttons */}
            <div className="flex justify-center lg:hidden mb-6">
              <img
                src="/hero-phone-v4.png"
                alt="AI phone receptionist active call screen"
                className="w-[350px] md:w-[420px]"
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
                <Link href="#how-it-works">See How It Works</Link>
              </Button>
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
                HIPAA compliant &middot; EMR integrations &middot; 70+ languages
              </p>
            </div>
          </div>

          {/* Desktop: Image on right */}
          <div className="hidden lg:flex justify-center items-center overflow-visible">
            <img
              src="/hero-phone-v4.png"
              alt="AI phone receptionist active call screen"
              className="w-[750px] max-w-none"
            />
          </div>
        </div>
      </div>

      {/* Logo Marquee */}
      <div className="mt-14 md:mt-20">
        <div className="py-6 md:py-8 overflow-hidden border-t border-neutral-100">
          <div className="mx-auto max-w-6xl px-4 md:px-6 mb-4 md:mb-6">
            <p className="text-center text-xs text-muted-foreground/60 uppercase tracking-widest font-medium">
              Trusted by eye care practices
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
