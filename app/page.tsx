import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import WhatWeBuild from "./components/WhatWeBuild";
import Results from "./components/Results";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "AI Phone Receptionist for Eye Care Practices | Acuity Health",
  description: "The AI phone receptionist built for ophthalmology and optometry. Handles scheduling, insurance checks, and appointment confirmations. Everything syncs to your EMR.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <Problem />
      <WhatWeBuild />
      <Results />
      <CTA />
    </>
  );
}
