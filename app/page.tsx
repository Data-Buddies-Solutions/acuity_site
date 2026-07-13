import type { Metadata } from "next";
import Hero from "./components/Hero";
import OfferStory from "./components/OfferStory";
import ProofNarrative from "./components/ProofNarrative";
import ProductShowcase from "./components/ProductShowcase";
import FinalCta from "./components/FinalCta";

export const metadata: Metadata = {
  title: { absolute: "AI Receptionist for Specialty Medical Practices | Acuity Health" },
  description:
    "AI receptionist for specialty medical practices. Answer every patient call, book appointments directly into your EMR, and never miss a call.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <OfferStory />
      <ProofNarrative />
      <ProductShowcase />
      <FinalCta />
    </>
  );
}
