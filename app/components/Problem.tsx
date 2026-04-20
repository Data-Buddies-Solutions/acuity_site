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
    <section ref={sectionRef} className="py-20 md:py-28 bg-[#0f1516] text-white" id="problem">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div
          className={`transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <p className="text-xs font-medium text-[#6bc7ca] uppercase tracking-widest mb-5">Where engagement breaks</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-10 lg:gap-16 items-start">
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <h2 className="text-3xl md:text-4xl lg:text-[3.1rem] font-semibold tracking-tight leading-[1.05] text-white">
              By the time a patient reaches the exam room, they have already decided how responsive your practice feels.
            </h2>
            <p className="mt-6 max-w-2xl text-base md:text-lg leading-relaxed text-white/72">
              Hold times, voicemail, repeated explanations, and after-hours dead ends do not just slow
              the front desk down. They shape trust, booking behavior, and whether the practice feels
              organized before care even begins.
            </p>
          </div>

          <div
            className={`rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 transition-all duration-700 delay-150 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-widest text-[#6bc7ca]">
              What patients and staff feel
            </p>
            <div className="mt-5 space-y-4">
              {[
                "Patients feel friction before they ever schedule.",
                "After-hours demand quietly leaks away.",
                "Staff lose time to repetitive phone work.",
                "The practice feels harder to reach than it should.",
              ].map((item) => (
                <div key={item} className="rounded-2xl bg-white/[0.05] px-4 py-4 text-sm leading-relaxed text-white/76">
                  {item}
                </div>
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
              className={`rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-7 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ transitionDelay: `${300 + i * 100}ms` }}
            >
              <p className="text-4xl md:text-5xl font-semibold tracking-tight text-[#8ce3e5]">{item.number}</p>
              <p className="mt-3 text-sm font-semibold text-white">{item.label}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{item.detail}</p>
            </div>
          ))}
        </div>

        <div
          className={`mt-14 text-center transition-all duration-700 delay-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <p className="text-sm md:text-base text-white/70 uppercase tracking-[0.16em]">
            Acuity changes the feeling of first contact.
          </p>
        </div>
      </div>
    </section>
  );
}
