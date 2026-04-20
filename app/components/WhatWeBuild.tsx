"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const workflowSteps = [
  {
    number: "1",
    eyebrow: "AI receptionist",
    title: "Answers every call without hold time or dropped demand.",
    description:
      "Acuity answers instantly, responds in the patient's language, and gives the practice a consistent front door across business hours and after hours.",
    image: "/step1-call.png",
    alt: "AI receptionist answering an inbound patient call",
    className: "bg-muted",
    imageShellClass: "bg-white/90 border border-neutral-200/80",
    imageWidth: "max-w-[220px]",
  },
  {
    number: "2",
    eyebrow: "Scheduling workflows",
    title: "Books, confirms, cancels, and reschedules appointments.",
    description:
      "It handles scheduling logic, insurance-related intake and checks, and transfers calls with context when a human needs to step in.",
    image: "/step2-schedule.png",
    alt: "Acuity scheduling an ophthalmology appointment",
    className: "bg-[#f4faf9]",
    imageShellClass: "bg-white/90 border border-[#d7ece8]",
    imageWidth: "max-w-[210px]",
  },
  {
    number: "3",
    eyebrow: "Patient engagement",
    title: "Keeps reminders, confirmations, and two-way texting moving.",
    description:
      "After the call, Acuity continues the conversation with reminder texts, confirmations, follow-up, and patient messaging that reduces front-desk back-and-forth.",
    image: "/step3-emr.png",
    alt: "Patient communication and appointment data syncing into the workflow",
    className: "bg-white",
    imageShellClass: "bg-[#f7fbfb] border border-neutral-200/80",
    imageWidth: "max-w-[220px]",
  },
  {
    number: "4",
    eyebrow: "Analytics and visibility",
    title: "Shows the team what is happening across the front desk.",
    description:
      "Analytics make it easier to see call volume, booking activity, after-hours demand, and where workflows need attention across the practice.",
    image: "/value-dashboard.png",
    alt: "Analytics dashboard showing front-desk activity and outcomes",
    className: "bg-[#f7fbfb]",
    imageShellClass: "bg-white border border-neutral-200/80",
    imageWidth: "max-w-[260px]",
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
    <section ref={sectionRef} className="py-20 md:py-28 bg-white" id="how-it-works">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">How Acuity works</p>
          <h2 className="text-3xl md:text-4xl lg:text-[3rem] font-semibold tracking-tight leading-[1.05] mb-5">
            Acuity handles the front desk, then keeps patient communication moving.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl">
            An AI receptionist handles calls first, followed by scheduling, texting, and analytics
            across the practice.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {workflowSteps.map((step, index) => (
            <div
              key={step.number}
              className={`relative overflow-hidden rounded-[2rem] p-6 shadow-card transition-all duration-700 md:p-7 ${step.className} ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ transitionDelay: `${150 + index * 120}ms` }}
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-accent">{step.number}</span>
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{step.eyebrow}</p>
              </div>

              <div className="flex min-h-full flex-col">
                <h3 className="text-xl md:text-2xl font-semibold tracking-tight text-neutral-900">
                  {step.title}
                </h3>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed mt-3">
                  {step.description}
                </p>

                <div className="mt-6 flex-1 flex items-end">
                  <div
                    className={`w-full rounded-[1.5rem] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] md:p-5 ${step.imageShellClass}`}
                  >
                    <Image
                      src={step.image}
                      alt={step.alt}
                      width={520}
                      height={520}
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
                      className={`mx-auto h-auto w-full ${step.imageWidth} rounded-xl`}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
