"use client";

import { useState } from "react";
import BookCallButton from "./BookCallButton";
import Link from "next/link";
import { Button } from "./ui/button";

export default function Results() {
  const [callsPerDay, setCallsPerDay] = useState(50);

  // Revenue: 20% missed × 20% would book × $250 avg × 22 days
  const missedCalls = Math.round(callsPerDay * 0.2);
  const recoveredAppts = Math.round(missedCalls * 0.2 * 22);
  const revenuePerMonth = recoveredAppts * 250;

  // Cost: 65% handled by AI × 3 min avg × 22 days
  const minutesSaved = Math.round(callsPerDay * 0.65 * 3 * 22);
  const hoursSaved = Math.round(minutesSaved / 60);

  return (
    <section className="py-20 md:py-28 bg-muted" id="results">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        <p className="text-xs font-medium text-accent uppercase tracking-widest mb-4">Impact calculator</p>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-8 md:mb-10">
          Estimate what better patient engagement can unlock
        </h2>

        {/* Slider */}
        <div className="mb-10 md:mb-14">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm text-muted-foreground">Calls per day</span>
            <span className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">{callsPerDay}</span>
          </div>
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={callsPerDay}
            onChange={(e) => setCallsPerDay(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-neutral-200 accent-accent"
          />
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-neutral-400">10</span>
            <span className="text-xs text-neutral-400">200</span>
          </div>
        </div>

        {/* Three metrics — free floating */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6 mb-10 md:mb-14">
          <div>
            <p className="text-4xl md:text-5xl font-bold text-accent tracking-tight tabular-nums leading-none">
              ${revenuePerMonth.toLocaleString()}
            </p>
            <p className="text-sm font-medium text-neutral-900 mt-3">Monthly revenue protected</p>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              {missedCalls} missed calls/day &times; 20% booking rate &times; $250 avg visit
            </p>
          </div>

          <div>
            <p className="text-4xl md:text-5xl font-bold text-accent tracking-tight tabular-nums leading-none">
              {hoursSaved}hrs
            </p>
            <p className="text-sm font-medium text-neutral-900 mt-3">Monthly staff capacity returned</p>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              65% of calls handled by AI &times; 3 min avg call
            </p>
          </div>

          <div>
            <p className="text-4xl md:text-5xl font-bold text-accent tracking-tight leading-none">
              91%
            </p>
            <p className="text-sm font-medium text-neutral-900 mt-3">Projected patient satisfaction</p>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Up from ~75% industry avg with hold times and voicemail
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <BookCallButton
            size="default"
            className="text-sm px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity"
            iconVariant="arrow-right"
          >
            See what this looks like for your practice
          </BookCallButton>
          <Button
            variant="ghost"
            size="default"
            className="text-sm px-2 text-muted-foreground hover:text-foreground"
            asChild
          >
            <Link href="/#results">Stay on the story</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
