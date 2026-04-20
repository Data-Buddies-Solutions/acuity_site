"use client";

import { useEffect, useRef, useState } from "react";

export default function Problem() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.15 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 md:py-28 bg-white" id="problem">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div
          className={`transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-5">Why this matters</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-10 lg:gap-16 items-start">
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <h2 className="text-3xl md:text-4xl lg:text-[3.1rem] font-semibold tracking-tight leading-[1.05]">
              A more responsive front desk improves patient experience.
            </h2>
            <p className="mt-6 max-w-2xl text-base md:text-lg leading-relaxed text-muted-foreground">
              Missed calls, voicemail, and after-hours dead ends do more than create friction. They
              slow booking, increase repetitive phone work, and make the practice feel harder to
              reach.
            </p>
          </div>

          <div
            className={`transition-all duration-700 delay-150 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              What a responsive front desk changes
            </p>
            <div className="mt-5 space-y-4">
              {[
                "More inbound demand turns into booked appointments.",
                "After-hours demand gets captured instead of falling into voicemail.",
                "Staff spend less time on repetitive phone work.",
                "Patients reach the practice with less friction and more confidence.",
              ].map((item) => (
                <p key={item} className="text-sm md:text-base leading-relaxed text-muted-foreground border-l-2 border-accent/25 pl-4">
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-14">
          {[
            {
              number: "23%",
              label: "of patient calls go to voicemail",
              detail: "Missed calls weaken engagement and create lost appointment opportunities.",
            },
            {
              number: "15%",
              label: "of calls come in after hours",
              detail: "Demand does not stop when the front desk goes home for the day.",
            },
            {
              number: "25+",
              label: "hours per week on the phone",
              detail: "Staff get pulled into repetitive scheduling and confirmation work instead of patient-facing care.",
            },
          ].map((item, i) => (
            <div
              key={item.label}
              className={`rounded-[1.75rem] bg-muted/35 p-7 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ transitionDelay: `${300 + i * 100}ms` }}
            >
              <p className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient">{item.number}</p>
              <p className="mt-3 text-sm font-semibold text-neutral-900">{item.label}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>

        <div
          className={`mt-14 text-center transition-all duration-700 delay-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <p className="text-sm md:text-base text-muted-foreground uppercase tracking-[0.16em]">
            Acuity makes the front desk more responsive.
          </p>
        </div>
      </div>
    </section>
  );
}
