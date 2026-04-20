import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import WhatWeBuild from "./components/WhatWeBuild";
import OfferStory from "./components/OfferStory";
import ProofNarrative from "./components/ProofNarrative";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "Patient Engagement Platform for Ophthalmology Practices | Acuity Health",
  description:
    "Acuity Health helps ophthalmology practices answer every patient call, reduce front-desk overload, and keep scheduling, reminders, and follow-up moving.",
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
      <OfferStory />
      <ProofNarrative />
      <CTA />
    </>
  );
}
