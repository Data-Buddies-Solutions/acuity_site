import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import WhatWeBuild from "./components/WhatWeBuild";
import Results from "./components/Results";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "Patient Access and Engagement for Eye Care Practices | Acuity Health",
  description:
    "Acuity Health helps ophthalmology and optometry practices answer every patient call, reduce front-desk overload, and keep patient communication moving.",
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
