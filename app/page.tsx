import type { Metadata } from "next";
import Hero from "./components/Hero";
import WhatWeBuild from "./components/WhatWeBuild";
import Testimonials from "./components/Testimonials";
import WhoWeAre from "./components/WhoWeAre";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "AI Phone System for Medical Teams | Acuity Health",
  description: "The AI phone system that handles scheduling, appointment reminders, and patient education, so your staff can get back to the human stuff.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <WhatWeBuild />
      <Testimonials />
      <WhoWeAre />
      <CTA />
    </>
  );
}
