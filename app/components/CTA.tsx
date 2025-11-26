"use client";

import { useState } from "react";

export default function CTA() {
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      const subject = encodeURIComponent("Business Automation Inquiry");
      const body = encodeURIComponent(`I'm interested in automating the following:\n\n${message}`);
      window.location.href = `mailto:team@databuddiessolutions.com?subject=${subject}&body=${body}`;
    }
  };

  return (
    <section className="relative py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="rounded-3xl border border-border/50 bg-muted/30 p-8 md:p-12">
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <h2 className="text-xl font-semibold tracking-tight md:text-2xl text-left whitespace-nowrap">
                What's slowing down your business?
              </h2>
              <div className="flex flex-col sm:flex-row gap-4 items-center w-full md:w-auto md:ml-auto">
                <div className="w-full sm:w-80">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what's eating your time"
                    className="w-full h-12 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-xl h-12 px-8 text-base font-semibold whitespace-nowrap bg-accent hover:bg-accent-hover text-white transition-colors"
                >
                  Email Us
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
