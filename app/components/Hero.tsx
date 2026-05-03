"use client";

import Image from "next/image";
import Link from "next/link";

import BookCallButton from "./BookCallButton";
import { Button } from "./ui/button";

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
    <section
      className="relative overflow-hidden bg-white pb-12 pt-6 md:pt-10 lg:pt-12"
      id="top"
    >
      <div className="relative z-10 mx-auto max-w-7xl px-4 md:px-6">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)] lg:gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] xl:gap-10">
          {/* Left: copy */}
          <div className="relative z-20 text-center lg:text-left">
            <h1 className="text-[2.75rem] font-semibold tracking-[-0.04em] leading-[1.05] antialiased subpixel-antialiased md:text-[3.25rem] lg:text-[2.5rem] xl:text-[3rem] 2xl:text-[3.5rem]">
              <span className="block">The</span>
              <span className="block text-accent">patient engagement</span>
              <span className="block">platform for</span>
              <span className="block">ophthalmology.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg lg:mx-0">
              An AI receptionist that answers patients, books appointments, and keeps
              follow-ups moving.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4 lg:justify-start">
              <Button
                asChild
                className="w-full rounded-full px-7 py-3 text-sm transition-opacity hover:opacity-90 sm:w-auto md:text-base"
                size="default"
                variant="default"
              >
                <Link href="/#offers">See the Platform</Link>
              </Button>
              <BookCallButton
                className="w-full rounded-full border border-neutral-300 bg-white px-7 py-3 text-sm text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 sm:w-auto md:text-base"
                iconVariant="none"
                size="default"
                variant="secondary"
              >
                Book a Demo
              </BookCallButton>
            </div>
          </div>

          {/* Right: agent flow illustration — cropped tight, full visible */}
          <div className="relative lg:-ml-8 lg:-mr-20 lg:mt-32 xl:-ml-12 xl:-mr-24 xl:mt-40">
            <div
              className="relative w-full overflow-hidden"
              style={{ aspectRatio: "1448 / 720" }}
            >
              <Image
                alt="Acuity AI agent moving a patient request through scheduling, EMR, calendar, and SMS confirmation"
                className="absolute h-auto w-full"
                height={1086}
                priority
                quality={95}
                sizes="(max-width: 1024px) 100vw, 60vw"
                src="/hero-agent-flow.jpg"
                style={{
                  top: "50%",
                  left: 0,
                  transform: "translateY(-50%)",
                }}
                width={1448}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Logo Marquee */}
      <div className="relative z-10 mt-32 md:mt-44 lg:mt-52">
        <div className="overflow-hidden border-t border-neutral-100 py-6 md:py-8">
          <div className="mx-auto mb-4 max-w-6xl px-4 md:mb-6 md:px-6">
            <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
              Trusted by eye care practices and technology partners
            </p>
          </div>
          <div className="relative">
            <div className="absolute bottom-0 left-0 top-0 z-10 w-20 bg-gradient-to-r from-background to-transparent md:w-40" />
            <div className="absolute bottom-0 right-0 top-0 z-10 w-20 bg-gradient-to-l from-background to-transparent md:w-40" />

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
