import type { Metadata } from "next";
import Hero from "./components/Hero";
import WhatWeBuild from "./components/WhatWeBuild";
import Testimonials from "./components/Testimonials";
import WhoWeAre from "./components/WhoWeAre";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "AI Agents for Eyecare Practices | Data Buddies Solutions",
  description: "We design, build, and implement custom AI agents that handle your eyecare practice's administrative workflows—so your team can focus on patient care.",
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
