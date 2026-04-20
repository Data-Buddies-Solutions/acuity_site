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
      <section ref={sectionRef} className="py-20 md:py-28 bg-white" id="how-it-works">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20 items-start">
            <div>
              <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">How the experience changes</p>
              <h2 className="text-3xl md:text-4xl lg:text-[3rem] font-semibold tracking-tight leading-[1.05] mb-5">
                From first call to confirmed visit, the patient keeps moving.
              </h2>
              <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl">
                Acuity answers instantly, handles routine work, and keeps your EMR and staff aligned when a human needs to step in.
              </p>

              <div className="mt-10 rounded-[2rem] border border-neutral-200 bg-muted/40 p-7">
                <p className="text-xs font-medium text-accent uppercase tracking-widest mb-3">
                  What improves
                </p>
                <div className="space-y-0">
                  {valueProps.map((prop, i) => (
                    <div
                      key={prop.title}
                      className={`flex items-start gap-4 py-4 transition-all duration-700 ${
                        i !== valueProps.length - 1 ? "border-b border-neutral-200" : ""
                      } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
                      style={{ transitionDelay: `${500 + i * 90}ms` }}
                    >
                      <div className="w-8 h-8 rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                        {prop.number}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900">{prop.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed mt-1">{prop.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
              <div
                className={`relative md:col-span-7 rounded-[2rem] bg-muted p-6 shadow-card transition-all duration-700 ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
                }`}
              >
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-accent">1</span>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Patient reaches out</p>
                </div>
                <div className="flex justify-center my-5">
                  <img
                    src="/step1-call.png"
                    alt="Patient calling the practice"
                    className="w-full max-w-[240px] rounded-xl"
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  Instant answer. No hold. No phone tree.
                </p>
              </div>

              <div
                className={`relative md:col-span-5 md:mt-12 rounded-[2rem] bg-[#f4faf9] p-6 shadow-card transition-all duration-700 delay-150 ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
                }`}
              >
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-accent">2</span>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Acuity resolves or routes</p>
                </div>
                <div className="flex justify-center my-5">
                  <img
                    src="/step2-schedule.png"
                    alt="AI scheduling an appointment"
                    className="w-full max-w-[220px] rounded-xl"
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  Scheduling, insurance checks, confirmations, or a transfer with context.
                </p>
              </div>

              <div
                className={`relative md:col-span-8 md:ml-12 rounded-[2rem] bg-white border border-neutral-200 p-6 shadow-card transition-all duration-700 delay-300 ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
                }`}
              >
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-accent">3</span>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Practice stays in sync</p>
                </div>
                <div className="flex justify-center my-5">
                  <img
                    src="/step3-emr.png"
                    alt="Appointment synced to EMR"
                    className="w-full max-w-[240px] rounded-xl"
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  Appointments and context land in your EMR automatically.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
