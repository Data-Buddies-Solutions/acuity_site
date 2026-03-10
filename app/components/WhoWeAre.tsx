"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Target, CheckCircle, Wrench } from "lucide-react";

const reasons = [
  {
    icon: SlidersHorizontal,
    title: "Your rules, your way",
    description:
      "Knows your insurances, scheduling logic, and how you talk to patients. No generic scripts.",
  },
  {
    icon: Target,
    title: "No compromises",
    description:
      "We validate your EMR endpoints and design around your actual workflow — not the other way around.",
  },
  {
    icon: CheckCircle,
    title: "Proven approach",
    description:
      "The same method we used to build a tailored solution for a large ophthalmology practice that found off-the-shelf too limiting.",
  },
  {
    icon: Wrench,
    title: "White-glove setup",
    description:
      "We handle everything from configuration to go-live. Your team gets a fully working system without needing any technical expertise.",
  },
];

export default function WhoWeAre() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.15 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 md:py-28 bg-neutral-50" id="about">
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        {/* Header */}
        <div
          className={`text-center mb-12 md:mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
            Your Practice. Your Agent.
          </h2>
          <p className="text-sm md:text-base text-neutral-500 max-w-xl mx-auto">
            Most AI phone solutions are one-size-fits-all. We&apos;ve made custom scalable — so your agent works exactly like your practice does.
          </p>
        </div>

        {/* Reasons list */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
          {reasons.map((reason, i) => (
            <div
              key={reason.title}
              className={`flex items-start gap-4 py-5 border-b border-neutral-200 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${150 + i * 100}ms` }}
            >
              <reason.icon className="w-5 h-5 text-neutral-900 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm md:text-base font-semibold text-neutral-900">
                  {reason.title}
                </h3>
                <p className="text-xs md:text-sm text-neutral-500 leading-relaxed mt-0.5">
                  {reason.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
