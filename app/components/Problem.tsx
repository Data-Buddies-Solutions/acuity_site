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
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        {/* Section label */}
        <div
          className={`transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">The problem</p>
        </div>

        {/* Headline — editorial style */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-semibold tracking-tight leading-[1.15]">
              Patient engagement starts
              <span className="text-muted-foreground"> before the visit.</span>
            </h2>
          </div>

          <div
            className={`hidden lg:block transition-all duration-700 delay-150 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <p className="text-base text-muted-foreground leading-relaxed">
              When patients hit hold times, voicemail, and repeated questions just to schedule, trust drops before care even begins. Your team burns hours on repetitive phone work while after-hours demand goes unanswered.
            </p>
          </div>
        </div>

        {/* Three pain points — horizontal cards, no icons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-14">
          {[
            {
              number: "23%",
              label: "of patient calls go to voicemail",
              detail: "Missed calls create patient access friction and lost appointment opportunities.",
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
              className={`p-6 rounded-2xl bg-neutral-50 border border-neutral-100 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ transitionDelay: `${300 + i * 100}ms` }}
            >
              <p className="text-3xl md:text-4xl font-semibold text-gradient tracking-tight">{item.number}</p>
              <p className="text-sm font-semibold text-neutral-900 mt-2">{item.label}</p>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>

        {/* Transition line to next section */}
        <div
          className={`mt-14 text-center transition-all duration-700 delay-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <p className="text-base text-muted-foreground">
            Acuity gives your practice a more responsive front door.
          </p>
          <div className="w-px h-10 bg-neutral-200 mx-auto mt-4" />
        </div>
      </div>
    </section>
  );
}
