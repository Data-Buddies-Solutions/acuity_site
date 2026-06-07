"use client";

import { PhoneCall } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import BookCallButton from "./BookCallButton";
import { Button } from "./ui/button";

const partners = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg" },
  { name: "Abita Eye Group", logo: "/logo-abita.png" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg" },
  { name: "OnlineDoctorNote", logo: "/logo-onlinedoctornote.png" },
];

const duplicatedPartners = [...partners, ...partners];

export default function Hero() {
  return (
    <section
      className="relative overflow-hidden bg-canvas pb-12 pt-10 md:pt-14 lg:pt-16"
      id="top"
    >
      <div className="relative z-10 mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto flex min-w-0 max-w-6xl flex-col items-center text-center">
          <Link
            className="marketing-label group mb-7 inline-flex items-center gap-2 rounded-[4px] border border-[#dfe4ec] bg-white/88 px-3.5 py-2 text-[11px] font-medium tracking-[0.12em] text-[#586372] shadow-sm backdrop-blur transition-colors hover:border-accent/45 hover:text-[#101820]"
            href="/partners/advancedmd"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Acuity × AdvancedMD partnership
            <span className="text-neutral-400 transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
          <h1 className="max-w-5xl text-[3.15rem] leading-[0.94] text-[#101820] antialiased subpixel-antialiased sm:text-[4.5rem] md:text-[5.6rem] lg:text-[6.8rem] xl:text-[7.4rem]">
            <span className="block">The</span>
            <span className="block text-[#3f4f6a]">AI receptionist</span>
            <span className="block">
              for ophthalmology <span className="block sm:inline">practices.</span>
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-[16px] leading-[1.6] text-[#586372] md:mt-7 md:text-[1.28rem]">
            Answer every call, help patients get what they need, and keep your front desk
            focused on the people in front of them.
          </p>

          <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:gap-4 md:mt-10">
            <Button
              asChild
              className="marketing-cta w-full rounded-[4px] bg-[#172033] px-5 py-3 text-[12px] font-medium tracking-[0.11em] shadow-[0_18px_42px_rgba(23,32,51,0.18)] transition-colors hover:bg-[#22304a] sm:w-auto md:px-6"
              size="default"
              variant="default"
            >
              <a
                aria-label="Call the Acuity AI receptionist live demo at 484 398 9071"
                className="inline-flex items-center gap-2"
                href="tel:+14843989071"
              >
                <PhoneCall className="h-4 w-4" />
                Try the AI Receptionist
              </a>
            </Button>
            <BookCallButton
              className="marketing-cta w-full rounded-[4px] border border-[#d4dae3] bg-white px-5 py-3 text-[12px] font-medium tracking-[0.11em] text-[#172033] shadow-sm transition-colors hover:border-[#bdc7d7] hover:bg-[#f7f8fb] sm:w-auto md:px-6"
              iconVariant="none"
              size="default"
              variant="secondary"
            >
              Book a Demo
            </BookCallButton>
          </div>
        </div>
      </div>

      {/* Logo Marquee */}
      <div className="relative z-10 mt-10 md:mt-8 lg:mt-2">
        <div className="overflow-hidden border-t border-neutral-100 py-6 md:py-8">
          <div className="mx-auto mb-4 max-w-6xl px-4 md:mb-6 md:px-6">
            <p className="marketing-label text-center text-[11px] font-medium tracking-[0.14em] text-muted-foreground/60">
              Trusted by eye care practices
            </p>
          </div>
          <div className="relative">
            <div className="absolute bottom-0 left-0 top-0 z-10 w-20 bg-gradient-to-r from-canvas to-transparent md:w-40" />
            <div className="absolute bottom-0 right-0 top-0 z-10 w-20 bg-gradient-to-l from-canvas to-transparent md:w-40" />

            <div className="logo-carousel flex animate-scroll items-center gap-10 md:gap-20">
              {duplicatedPartners.map((partner, index) => (
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
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
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
