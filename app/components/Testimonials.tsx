"use client";

import { useState, useEffect } from "react";

const testimonials = [
  {
    quote: "Acuity Health handles our phones now and gave hours back to our staff every week. We're booking more patients with less manual work.",
    author: "Dr. Shechtman",
    role: "North Miami Beach Eye Center",
  },
  {
    quote: "We had no way to track inventory or make smart purchasing decisions with suppliers. Now we have full visibility and save thousands every month.",
    author: "Dr. Laura Falco",
    role: "Jazzy Eyes Optical",
  },
  {
    quote: "I was spending 4+ hours a day on manual admin work. Acuity Health gave me my life back. I can finally focus on what matters.",
    author: "Jason Buchwald",
    role: "OnlineDoctorNote",
  },
];

export default function Testimonials() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % testimonials.length);
        setIsAnimating(false);
      }, 300);
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  const current = testimonials[currentIndex];

  return (
    <section className="py-20 md:py-28 bg-white" id="testimonials">
      <div className="mx-auto max-w-4xl px-6">
        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            What practices say
          </h2>
        </div>

        {/* Single rotating testimonial */}
        <div className="text-center">
          <div
            className={`transition-all duration-300 ${
              isAnimating
                ? "opacity-0 translate-y-4"
                : "opacity-100 translate-y-0"
            }`}
          >
            {/* Quote */}
            <blockquote className="text-2xl md:text-3xl lg:text-4xl font-medium text-foreground leading-snug mb-8">
              &ldquo;{current.quote}&rdquo;
            </blockquote>

            {/* Author */}
            <div>
              <p className="text-lg font-semibold text-foreground">{current.author}</p>
              <p className="text-muted-foreground">{current.role}</p>
            </div>
          </div>

          {/* Dots indicator */}
          <div className="flex items-center justify-center gap-2 mt-10">
            {testimonials.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setIsAnimating(true);
                  setTimeout(() => {
                    setCurrentIndex(index);
                    setIsAnimating(false);
                  }, 300);
                }}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  index === currentIndex
                    ? "bg-accent w-6"
                    : "bg-border hover:bg-muted-foreground"
                }`}
                aria-label={`Go to testimonial ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
