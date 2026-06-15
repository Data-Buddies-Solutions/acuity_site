import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import WhatWeBuild from "./components/WhatWeBuild";
import OfferStory from "./components/OfferStory";
import ProofNarrative from "./components/ProofNarrative";

export const metadata: Metadata = {
  title: { absolute: "AI Receptionist for Ophthalmology | Acuity Health" },
  description:
    "AI receptionist for ophthalmology. Answer every patient call, book appointments directly into your EMR, and never miss a call.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <Problem />
      <OfferStory />
      <ProofNarrative />
      <WhatWeBuild />
    </>
  );
}
