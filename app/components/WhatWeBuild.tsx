"use client";

import { useEffect, useRef, useState } from "react";
const valueProps = [
  {
    number: "01",
    title: "Capture more patient demand",
    description: "Every answered call is a chance to book, retain, or route a patient instead of sending them elsewhere.",
  },
  {
    number: "02",
    title: "Reduce front-desk overload",
    description: "Acuity handles repetitive phone volume so your team can stay focused on patients who are already in the office.",
  },
  {
    number: "03",
    title: "Improve patient engagement",
    description: "Scheduling, confirmations, and follow-up feel consistent, professional, and accessible in 70+ languages.",
  },
  {
    number: "04",
    title: "Modernize the phone layer",
    description: "Upgrade from hold queues and legacy hardware to a dependable, cloud-based phone system designed for growth.",
  },
];

export default function WhatWeBuild() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* How It Works — 3-step visual flow */}
      <section ref={sectionRef} className="py-20 md:py-28 bg-muted" id="how-it-works">
        <div className="mx-auto max-w-5xl px-4 md:px-6">
          <div className="text-center mb-14 md:mb-18">
            <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">How it works</p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
              From first call to confirmed visit.
            </h2>
            <p className="text-base text-muted-foreground max-w-lg mx-auto">
              Acuity answers instantly, handles routine patient communication, and keeps your EMR and staff aligned when a human needs to step in.
            </p>
          </div>

          {/* Steps as conversation snippets, not icon boxes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 1 */}
            <div
              className={`relative bg-white rounded-2xl p-6 shadow-card transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-accent">1</span>
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Patient reaches out</p>
              </div>
              <div className="flex justify-center my-4">
                <img
                  src="/step1-call.png"
                  alt="Patient calling the practice"
                  className="w-full max-w-[220px] rounded-xl"
                />
              </div>
              <p className="text-sm text-muted-foreground mt-4">Acuity picks up instantly. No hold, no phone tree, day or night.</p>
            </div>

            {/* Step 2 */}
            <div
              className={`relative bg-white rounded-2xl p-6 shadow-card transition-all duration-700 delay-150 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-accent">2</span>
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Acuity resolves or routes</p>
              </div>
              <div className="flex justify-center my-4">
                <img
                  src="/step2-schedule.png"
                  alt="AI scheduling an appointment"
                  className="w-full max-w-[220px] rounded-xl"
                />
              </div>
              <p className="text-sm text-muted-foreground mt-4">Schedules, checks insurance, confirms appointments, or transfers with full context when staff involvement matters.</p>
            </div>

            {/* Step 3 */}
            <div
              className={`relative bg-white rounded-2xl p-6 shadow-card transition-all duration-700 delay-300 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-accent">3</span>
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Practice stays in sync</p>
              </div>
              <div className="flex justify-center my-4">
                <img
                  src="/step3-emr.png"
                  alt="Appointment synced to EMR"
                  className="w-full max-w-[220px] rounded-xl"
                />
              </div>
              <p className="text-sm text-muted-foreground mt-4">Appointments and context land in your EMR automatically, so your team is not stuck re-entering the same information.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Value props — editorial two-column */}
      <section className="py-20 md:py-28 bg-white">
        <div className="mx-auto max-w-5xl px-4 md:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left: copy + bullets */}
            <div>
              <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">Why practices choose Acuity</p>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
                Built for patient engagement, not generic call handling
              </h2>
              <p className="text-base text-muted-foreground leading-relaxed mb-10">
                Acuity is configured around your appointment types, insurance rules, escalation paths, and the way your front desk actually works. The result is more responsive patient communication without sacrificing professionalism.
              </p>

              <div className="space-y-0">
                {valueProps.map((prop, i) => (
                  <div
                    key={prop.title}
                    className={`flex items-start gap-4 py-5 transition-all duration-700 ${
                      i !== valueProps.length - 1 ? "border-b border-neutral-100" : ""
                    } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
                    style={{ transitionDelay: `${400 + i * 100}ms` }}
                  >
                    <div className="w-2 h-2 rounded-full bg-accent mt-1.5 flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900">{prop.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed mt-1">{prop.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: dashboard image */}
            <div className="hidden lg:flex justify-center items-center">
              <img
                src="/value-dashboard.png"
                alt="Acuity Health dashboard showing call metrics and language support"
                className="w-full max-w-[520px]"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
