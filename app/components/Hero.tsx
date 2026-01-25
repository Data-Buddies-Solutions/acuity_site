"use client";

import { useState, useEffect } from "react";
import BookCallButton from "./BookCallButton";
import { Button } from "./ui/button";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

const partners = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png", width: "w-44", height: "h-14" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg", width: "w-44", height: "h-14" },
  { name: "ElevenLabs", logo: "/logo-elevenlabs.png", width: "w-44", height: "h-14" },
  { name: "Abita Eye Group", logo: "/logo-abita.png", width: "w-44", height: "h-14" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg", width: "w-44", height: "h-14" },
  { name: "OnlineDoctorNote", logo: "/logo-onlinedoctornote.png", width: "w-52", height: "h-14" },
];

const duplicatedPartners = [...partners, ...partners];

const solutions = ["Scheduling", "Referrals", "Pre-Auth", "Phone Calls"];

export default function Hero() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % solutions.length);
        setIsAnimating(false);
      }, 200);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative pt-20 md:pt-24 lg:pt-28 pb-14 md:pb-20 bg-background" id="top">
      {/* Centered Content */}
      <div className="mx-auto max-w-4xl px-6 text-center">
        {/* Headline with rotating word - Stack AI style: medium weight, tight letter spacing */}
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-medium tracking-[-0.03em] leading-[1.1] mb-5">
          AI agents that handle
          <br />
          <span
            className={`inline-block text-accent mt-2 transition-all duration-200 ${
              isAnimating
                ? "opacity-0 translate-y-2"
                : "opacity-100 translate-y-0"
            }`}
          >
            {solutions[currentIndex]}
          </span>
        </h1>

        {/* Subheadline - Stack AI style: smaller, reduced opacity */}
        <p className="text-base md:text-lg text-foreground/70 mb-10 leading-relaxed max-w-xl mx-auto">
          Automate admin work with AI agents that handle front office tasks.
          <br />
          Loved by optometrists, ophthalmologists, and medical teams.
        </p>

        {/* CTAs - Stack AI style: minimal, clean buttons */}
        <div className="flex flex-row items-center justify-center gap-4">
          <BookCallButton size="default" className="text-base px-6 py-3 rounded-lg" iconVariant="none">
            Book a Call
          </BookCallButton>
          <Button variant="ghost" size="default" className="text-base px-6 py-3 text-foreground/80 hover:text-foreground" asChild>
            <Link href="#what-we-build">
              Learn More
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Logo Marquee - Stack AI style: minimal label */}
      <div className="mt-20 md:mt-24 overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 mb-6">
          <p className="text-center text-sm text-foreground/50 uppercase tracking-wide">Trusted by</p>
        </div>
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-background to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-background to-transparent z-10" />

          <div className="flex items-center gap-20 animate-scroll">
            {duplicatedPartners.map((partner, index) => (
              <div
                key={`${partner.name}-${index}`}
                className="flex-shrink-0 flex items-center justify-center"
              >
                <div className={`${partner.width} ${partner.height} relative flex items-center justify-center`}>
                  <Image
                    src={partner.logo}
                    alt={partner.name}
                    fill
                    className="object-contain grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
                  />
                </div>
              </div>
            ))}
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
          animation: scroll 30s linear infinite;
        }
        .animate-scroll:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
}
