import Image from "next/image";
import Link from "next/link";

import { Button } from "./ui/button";
import BookCallButton from "./BookCallButton";
import HexagonAnimation from "./HexagonAnimation";

export default function Hero() {
  return (
    <section className="section" id="top">
      <div className="mx-auto grid max-w-screen-xl gap-12 px-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center lg:gap-16">
        <div className="space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl lg:text-[3.25rem]">
              Your <span className="text-accent">Business Buddy</span> That Never Sleeps
            </h1>
            <p className="text-lg text-foreground/75 md:text-xl">
              Your AI buddy clears repetitive tasks so you can focus on the work that grows profit.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <BookCallButton iconVariant="none" className="rounded-full" />
            <Button asChild variant="secondary" size="lg" className="rounded-full">
              <Link href="#process">See how it works</Link>
            </Button>
          </div>
        </div>
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-accent via-accent/90 to-accent/70" />
          <div className="relative z-10">
            <HexagonAnimation />
          </div>
        </div>
      </div>
    </section>
  );
}
