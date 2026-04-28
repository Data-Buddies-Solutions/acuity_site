"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

const reasons = [
  {
    title: "Purpose-built for eye care",
    description:
      "Not a generic AI bolted onto healthcare. We built this for ophthalmology and optometry. Your appointment types, your insurance rules, your workflows.",
  },
  {
    title: "Patients actually prefer it",
    description:
      "No hold time, no phone tree, no repeating themselves. Patients get helped immediately. They like it better than waiting.",
  },
  {
    title: "Direct EMR integration",
    description:
      "Live with AdvancedMD today. Athena and Compulink in progress. Appointments sync directly. No clipboard, no double entry.",
  },
  {
    title: "White-glove setup",
    description:
      "We handle everything. Your insurance rules, scheduling logic, call flows. Your team gets a fully working system in 4–8 weeks without any technical work.",
  },
];

export default function WhoWeAre() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.15 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 md:py-28 bg-muted" id="why-acuity">
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          {/* Left: Photo placeholder + trust */}
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            {/* Photo placeholder — styled to look intentional */}
            <div className="rounded-2xl overflow-hidden aspect-[4/3] photo-placeholder mb-6">
              <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-8">
                {/* Eye care themed placeholder content */}
                <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-accent"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-accent/80">
                  Photo: Eye care practice in action
                </p>
                <p className="text-xs text-accent/50 mt-1">
                  Replace with real practice photography
                </p>
              </div>
            </div>

            {/* HIPAA badge + trust line */}
            <div className="flex items-center gap-3">
              <Image
                src="/hipaa-badge.webp"
                alt="HIPAA Compliant"
                width={80}
                height={36}
                className="opacity-70"
              />
              <div className="w-px h-6 bg-neutral-200" />
              <p className="text-xs text-muted-foreground">
                Fully HIPAA compliant. Patient data is never used for model training.
              </p>
            </div>
          </div>

          {/* Right: Value props — editorial, not icon grid */}
          <div>
            <div
              className={`mb-8 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">
                Why Acuity Health
              </p>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight leading-[1.15]">
                We only build for eye care.
                <span className="text-muted-foreground"> And it shows.</span>
              </h2>
            </div>

            <div className="space-y-0">
              {reasons.map((reason, i) => (
                <div
                  key={reason.title}
                  className={`py-5 border-b border-neutral-200 last:border-0 transition-all duration-700 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
                  }`}
                  style={{ transitionDelay: `${200 + i * 100}ms` }}
                >
                  <h3 className="text-base font-semibold text-neutral-900 mb-1">
                    {reason.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {reason.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
