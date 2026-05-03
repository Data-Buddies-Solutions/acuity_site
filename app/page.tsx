import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import WhatWeBuild from "./components/WhatWeBuild";
import OfferStory from "./components/OfferStory";
import ProofNarrative from "./components/ProofNarrative";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "Your AI Front Desk | Acuity Health",
  description:
    "Acuity is the AI front desk for ophthalmology practices. Answer every call, route work to the right place, and keep scheduling, texting, and analytics moving from one platform.",
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
      <WhatWeBuild />
      <ProofNarrative />
      <CTA />
    </>
  );
}
