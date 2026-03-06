"use client";

import { useState, useEffect } from "react";
import BookCallButton from "./BookCallButton";
import { Button } from "./ui/button";
import Link from "next/link";
import Image from "next/image";

const partners = [
  { name: "AdvancedMD", logo: "/logo-advancedmd.png", width: "w-44", height: "h-14" },
  { name: "Jazzy Eyes Optical", logo: "/logo-jazzyeyes.jpg", width: "w-44", height: "h-14" },
  { name: "ElevenLabs", logo: "/logo-elevenlabs.png", width: "w-44", height: "h-14" },
  { name: "Abita Eye Group", logo: "/logo-abita.png", width: "w-44", height: "h-14" },
  { name: "NMB Eye Center", logo: "/logo-nmbeyecenter.jpg", width: "w-44", height: "h-14" },
  { name: "OnlineDoctorNote", logo: "/logo-onlinedoctornote.png", width: "w-52", height: "h-14" },
];

const duplicatedPartners = [...partners, ...partners];

const solutions = ["Scheduling", "Appointment Reminders", "Patient Education"];

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
    <section className="relative pt-16 md:pt-24 lg:pt-28 pb-8 md:pb-20 bg-background overflow-hidden" id="top">
      {/* Centered Content */}
      <div className="relative z-10 mx-auto max-w-4xl px-4 md:px-6 text-center">
        {/* Headline with rotating word - Stack AI style: medium weight, tight letter spacing */}
        <h1 className="text-[2rem] md:text-5xl lg:text-6xl font-medium tracking-[-0.03em] leading-[1.1] mb-4 md:mb-5">
          <span className="md:whitespace-nowrap">The AI Phone System for Medical Teams</span>
        </h1>

        {/* Rotating value props */}
        <p className="text-2xl md:text-4xl text-accent font-medium">
          <span
            className={`inline-block transition-all duration-200 ${
              isAnimating
                ? "opacity-0 translate-y-2"
                : "opacity-100 translate-y-0"
            }`}
          >
            {solutions[currentIndex]}
          </span>
        </p>

        {/* CTA */}
        <div className="flex flex-row items-center justify-center gap-4 mt-8 md:mt-10">
          <BookCallButton size="default" className="text-base px-8 py-3 rounded-full hover:opacity-80 transition-opacity" iconVariant="none">
            Book a Demo
          </BookCallButton>
          <Button variant="outline" size="default" className="text-base px-8 py-3 rounded-full border-[1.5px] border-black bg-white text-stone-900 shadow-sm hover:opacity-80 transition-opacity" asChild>
            <Link href="#how-it-works">
              Learn More
            </Link>
          </Button>
        </div>
      </div>

      {/* Logo Marquee with grid lines - Stripe style */}
      <div className="mt-10 md:mt-24">
        {/* Grid lines above AND below carousel */}
        <div>
          <div className="py-6 md:py-8 overflow-hidden">
            <div className="mx-auto max-w-6xl px-4 md:px-6 mb-4 md:mb-6">
              <p className="text-center text-xs md:text-sm text-foreground/50 uppercase tracking-wide">Trusted by</p>
            </div>
            <div className="relative">
              <div className="absolute left-0 top-0 bottom-0 w-16 md:w-32 bg-gradient-to-r from-background to-transparent z-10" />
              <div className="absolute right-0 top-0 bottom-0 w-16 md:w-32 bg-gradient-to-l from-background to-transparent z-10" />

              <div className="logo-carousel flex items-center gap-8 md:gap-20 animate-scroll">
                {duplicatedPartners.map((partner, index) => (
                  <div
                    key={`${partner.name}-${index}`}
                    className="logo-carousel-item flex-shrink-0 flex items-center justify-center"
                  >
                    <div className="w-28 h-10 md:w-44 md:h-14 relative flex items-center justify-center">
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
        </div>
      </div>

      <style jsx>{`
        /* Logo carousel scroll animation */
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll {
          animation: scroll 20s linear infinite;
        }
        @media (min-width: 768px) {
          .animate-scroll {
            animation: scroll 30s linear infinite;
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
