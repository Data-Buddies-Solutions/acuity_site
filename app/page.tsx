import type { Metadata } from "next";
import Hero from "./components/Hero";
import Problems from "./components/Problems";
import Process from "./components/Process";
import CTA from "./components/CTA";

export const metadata: Metadata = {
  title: "AI Automation for Small Businesses",
  description: "Your Business Buddy That Never Sleeps. Data Buddies clear repetitive tasks so you can focus on the work that grows profit.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <Problems />
      <Process />
      <CTA />
    </>
  );
}
