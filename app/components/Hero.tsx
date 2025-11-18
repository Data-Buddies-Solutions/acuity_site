import Image from "next/image";
import Link from "next/link";

import { Button } from "./ui/button";
import BookCallButton from "./BookCallButton";
import HexagonAnimation from "./HexagonAnimation";

export default function Hero() {
  return (
    <section className="pt-4 pb-12 md:pt-12 md:pb-16" id="top">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="flex flex-col items-center space-y-3 sm:space-y-12">
          <div className="relative flex items-center justify-center w-[300px] h-[300px]">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent via-accent/90 to-accent/70" />
            <div className="relative z-10">
              <HexagonAnimation />
            </div>
          </div>
          <div className="space-y-4 sm:space-y-8 text-center">
            <div className="space-y-1">
              <h1 className="text-4xl font-semibold leading-tight md:text-5xl lg:text-[3.25rem]">
                Your <span className="text-accent">Business Buddy</span> That Never Sleeps
              </h1>
              <p className="text-lg text-foreground/75 md:text-xl">
                Data Buddies clear repetitive tasks so you can focus on the work that grows profit
              </p>
            </div>
            <div className="flex flex-row gap-3 items-center justify-center">
              <BookCallButton iconVariant="none" className="rounded-full h-9 px-4 text-sm sm:h-11 sm:px-6 sm:text-base" />
              <Button asChild variant="secondary" className="rounded-full h-9 px-4 text-sm sm:h-11 sm:px-6 sm:text-base">
                <Link href="#process">See how it works</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
