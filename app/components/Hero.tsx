import Image from "next/image";
import Link from "next/link";

import { Button } from "./ui/button";
import BookCallButton from "./BookCallButton";
import HexagonAnimation from "./HexagonAnimation";
import { Badge } from "./ui/badge";

export default function Hero() {
  return (
    <section className="relative border-b min-h-screen flex items-start justify-center pt-12 md:pt-16 pb-20" id="top">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="flex flex-col items-center space-y-6 md:space-y-8">
          <div className="relative flex items-center justify-center w-full max-w-sm h-[220px] md:max-w-md md:h-[260px]">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent via-accent/90 to-accent/70 blur-3xl opacity-30" />
            <div className="relative z-10">
              <HexagonAnimation />
            </div>
          </div>

          <div className="space-y-4 md:space-y-5 text-center max-w-4xl">
            <h1 className="text-4xl font-bold leading-tight tracking-tighter md:text-5xl lg:text-6xl">
              Your <span className="text-accent">Business Buddy</span> That Never Sleeps
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl lg:text-2xl max-w-3xl mx-auto">
              Data Buddies clear repetitive tasks so you can focus on the work that grows profit
            </p>
          </div>

          <div className="flex flex-row gap-4 items-center justify-center pt-2">
            <BookCallButton iconVariant="none" className="rounded-xl h-11 px-6 text-base font-semibold md:h-12 md:px-8" />
            <Button asChild variant="secondary" className="rounded-xl h-11 px-6 text-base font-semibold md:h-12 md:px-8">
              <Link href="#process">See how it works</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
