"use client";

import { useEffect, useRef, useState } from "react";
import {
  Phone,
  PhoneCall,
  Database,
  ShieldCheck,
  Globe,
  Zap,
  Ban,
  Clock,
  PhoneOutgoing,
  Bell,
  GraduationCap,
} from "lucide-react";

const capabilities = [
  {
    icon: Database,
    title: "Books into your EMR",
    description: "Appointments go straight into your system. No double entry.",
  },
  {
    icon: ShieldCheck,
    title: "Knows your insurance rules",
    description: "Custom built for your payers, plans, and authorization requirements.",
  },
  {
    icon: Globe,
    title: "70+ languages",
    description: "Speaks your patients' language, fluently.",
  },
  {
    icon: Zap,
    title: "20+ concurrent calls",
    description: "No more hold times. Every call gets answered.",
  },
  {
    icon: Ban,
    title: "Filters spam",
    description: "Only real patients get through to your schedule.",
  },
  {
    icon: Clock,
    title: "Works 24/7",
    description: "Nights, weekends, holidays. Always on.",
  },
];

export default function WhatWeBuild() {
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
    <section ref={sectionRef} className="py-16 md:py-24 bg-white" id="how-it-works">
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        {/* Section header */}
        <div className="text-center mb-12 md:mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-3 md:mb-4">
            How It Works
          </h2>
          <p className="text-sm md:text-base text-neutral-500 max-w-lg mx-auto">
            An AI voice answers your phones, books patients, and syncs everything to your EMR.
          </p>
        </div>

        {/* 3-step flow */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-0 mb-16 md:mb-20">
          {/* Step 1 */}
          <div
            className={`flex flex-col items-center text-center relative transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-neutral-900 flex items-center justify-center mb-4">
              <Phone className="w-7 h-7 md:w-9 md:h-9 text-white" />
            </div>
            <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">Step 1</div>
            <h3 className="text-lg md:text-xl font-semibold text-neutral-900 mb-1">Phone Rings</h3>
            <p className="text-sm text-neutral-500 max-w-[200px]">A patient calls your office</p>
            {/* Connector */}
            <div className="hidden md:block absolute top-10 right-0 translate-x-1/2 w-8 h-0.5 bg-neutral-200" />
            <div className="hidden md:block absolute top-[37px] right-0 translate-x-[calc(50%+14px)] w-2 h-2 border-r-2 border-t-2 border-neutral-300 rotate-45" />
          </div>

          {/* Step 2 */}
          <div
            className={`flex flex-col items-center text-center relative transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
            style={{ transitionDelay: "150ms" }}
          >
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-neutral-900 flex items-center justify-center mb-4">
              <PhoneCall className="w-7 h-7 md:w-9 md:h-9 text-white" />
            </div>
            <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">Step 2</div>
            <h3 className="text-lg md:text-xl font-semibold text-neutral-900 mb-1">AI Answers & Books</h3>
            <p className="text-sm text-neutral-500 max-w-[220px]">Speaks to the patient and schedules the appointment</p>
            {/* Connector */}
            <div className="hidden md:block absolute top-10 right-0 translate-x-1/2 w-8 h-0.5 bg-neutral-200" />
            <div className="hidden md:block absolute top-[37px] right-0 translate-x-[calc(50%+14px)] w-2 h-2 border-r-2 border-t-2 border-neutral-300 rotate-45" />
          </div>

          {/* Step 3 */}
          <div
            className={`flex flex-col items-center text-center transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
            style={{ transitionDelay: "300ms" }}
          >
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-emerald-500 flex items-center justify-center mb-4">
              <Database className="w-7 h-7 md:w-9 md:h-9 text-white" />
            </div>
            <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">Step 3</div>
            <h3 className="text-lg md:text-xl font-semibold text-neutral-900 mb-1">Synced to Your EMR</h3>
            <p className="text-sm text-neutral-500 max-w-[220px]">Appointment goes straight into your system</p>
          </div>
        </div>

        {/* Capability grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-16 md:mb-20">
          {capabilities.map((cap, i) => (
            <div
              key={cap.title}
              className={`p-5 md:p-6 rounded-2xl border border-neutral-100 bg-neutral-50/50 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${400 + i * 100}ms` }}
            >
              <cap.icon className="w-5 h-5 md:w-6 md:h-6 text-neutral-900 mb-3" />
              <h3 className="text-sm md:text-base font-semibold text-neutral-900 mb-1">{cap.title}</h3>
              <p className="text-xs md:text-sm text-neutral-500 leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>

        {/* Outbound section */}
        <div
          className={`rounded-2xl md:rounded-3xl bg-neutral-900 p-8 md:p-12 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
          style={{ transitionDelay: "1000ms" }}
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">
              <PhoneOutgoing className="w-4 h-4" />
              It also calls your patients
            </div>
            <h3 className="text-2xl md:text-3xl font-semibold text-white">Outbound Calls, Handled</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                <Bell className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-white mb-1">Appointment Reminders</h4>
                <p className="text-sm text-neutral-400">Calls patients to confirm upcoming visits and reduce no-shows</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-white mb-1">Patient Education</h4>
                <p className="text-sm text-neutral-400">Shares pre-op instructions, post-care info, and answers common questions</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
