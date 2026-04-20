import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import WhatWeBuild from "./components/WhatWeBuild";
import Differentiation from "./components/Differentiation";
import OfferStory from "./components/OfferStory";
import Results from "./components/Results";
import ProofNarrative from "./components/ProofNarrative";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "Patient Engagement for Eye Care Practices | Acuity Health",
  description:
    "Acuity Health helps ophthalmology and optometry practices improve patient engagement by answering calls, reducing front-desk overload, and keeping communication moving.",
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
      <Differentiation />
      <OfferStory />
      <Results />
      <ProofNarrative />
      <CTA />
    </>
  );
}
