import { PhoneCall } from "lucide-react";

import BookCallButton from "./BookCallButton";
import { Button } from "@/components/ui/button";

export default function FinalCta() {
  return (
    <section className="bg-canvas py-20 md:py-24">
      <div className="mx-auto max-w-4xl px-4 text-center md:px-6">
        <h2 className="text-4xl leading-[1.05] md:text-5xl lg:text-[3.5rem] [text-wrap:balance]">
          Give your front desk its time back.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Hear Acuity answer a real call, or show us how your practice works today.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <BookCallButton
            className="h-11 rounded-[4px] bg-[#172033] px-6 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(23,32,51,0.18)] hover:bg-[#22304a]"
            iconVariant="none"
            size="default"
          >
            Book a demo
          </BookCallButton>
          <Button
            asChild
            className="h-11 rounded-[4px] border-[#d4dae3] bg-white px-6 text-sm font-semibold text-[#172033] shadow-sm hover:bg-[#f7f8fb]"
            variant="secondary"
          >
            <a href="tel:+14843989071">
              <PhoneCall aria-hidden="true" className="size-4" />
              Call the live receptionist
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
