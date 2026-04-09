"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

const messages = [
  {
    role: "ai" as const,
    text: "Thank you for calling North Miami Beach Eye Center. How can I help you today?",
  },
  {
    role: "patient" as const,
    text: "Hi, I need to schedule an eye exam for next week.",
  },
  {
    role: "ai" as const,
    text: "I'd be happy to help! Are you a new or existing patient?",
  },
  {
    role: "patient" as const,
    text: "Existing patient. Last name is Torres.",
  },
  {
    role: "ai" as const,
    text: "I found your records, Maria. I have Thursday at 2:00 PM or Friday at 10:30 AM with Dr. Rodriguez. Which works better?",
  },
  {
    role: "patient" as const,
    text: "Thursday works.",
  },
  {
    role: "ai" as const,
    text: "You're all set! Thursday, April 10 at 2:00 PM with Dr. Rodriguez. We'll send a confirmation to your phone. Is there anything else?",
  },
];

export default function ConversationMockup() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    if (visibleCount < messages.length) {
      const delay = visibleCount === 0 ? 800 : 1200 + Math.random() * 600;
      const timer = setTimeout(() => {
        setVisibleCount((prev) => prev + 1);
      }, delay);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => setShowConfirmation(true), 800);
      return () => clearTimeout(timer);
    }
  }, [visibleCount]);

  return (
    <div className="w-full max-w-[380px] mx-auto">
      {/* Phone frame */}
      <div className="rounded-[28px] bg-white shadow-xl border border-neutral-200/80 overflow-hidden">
        {/* Header bar */}
        <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 !leading-tight">Acuity Health AI</p>
              <p className="text-[11px] text-accent font-medium !leading-tight mt-0.5">Active Call</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[11px] text-emerald-600 font-medium">Live</span>
            </div>
          </div>
        </div>

        {/* Conversation area */}
        <div className="px-4 py-5 space-y-3 min-h-[340px] bg-white">
          {messages.slice(0, visibleCount).map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "patient" ? "justify-end" : "justify-start"} animate-message`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div
                className={`max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  msg.role === "ai"
                    ? "bg-accent/8 text-neutral-800 rounded-2xl rounded-tl-md"
                    : "bg-neutral-100 text-neutral-700 rounded-2xl rounded-tr-md"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {visibleCount < messages.length && visibleCount > 0 && (
            <div className="flex justify-start">
              <div className="bg-accent/8 rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-accent/40"
                    style={{
                      animation: `dot-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* EMR sync confirmation */}
        {showConfirmation && (
          <div className="px-4 pb-4 animate-message">
            <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-white" strokeWidth={3} />
              </div>
              <div>
                <p className="text-xs font-semibold text-emerald-800 !leading-tight">Synced to AdvancedMD</p>
                <p className="text-[11px] text-emerald-600 !leading-tight mt-0.5">Appointment confirmed</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
