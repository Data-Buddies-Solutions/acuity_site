import type { Metadata } from "next";
import Hero from "./components/Hero";
import WhoWeAre from "./components/WhoWeAre";
import HowAgentsWork from "./components/HowAgentsWork";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "AI Automation for Small Businesses | Data Buddies",
  description: "Stop doing repetitive work. We build custom AI assistants that handle your busywork—from customer emails to data entry to scheduling—so you can focus on growing your business.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <HowAgentsWork />
      <WhoWeAre />
      <CTA />
    </>
  );
}
