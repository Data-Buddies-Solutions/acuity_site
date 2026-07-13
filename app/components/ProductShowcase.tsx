import Image from "next/image";

export default function ProductShowcase() {
  return (
    <section className="bg-white py-20 md:py-28" id="portal">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
            Current practice portal
          </p>
          <h2 className="mt-5 text-4xl leading-[1.05] md:text-5xl lg:text-[3.5rem] [text-wrap:balance]">
            Every call, booking, and handoff in one calm view.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            See what Acuity handled across locations without digging through phone-system
            reports or listening to every call.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-6xl overflow-hidden rounded-xl border border-[#d9dfe8] bg-[#f8fafc] shadow-[0_34px_90px_rgba(23,32,51,0.13)] md:mt-18">
          <Image
            alt="Acuity practice portal showing a seven-day overview of calls, appointments, staff handoffs, call volume, and call-time breakdown"
            className="h-auto w-full"
            height={932}
            quality={95}
            sizes="(max-width: 1280px) 100vw, 1152px"
            src="/portal-overview-current.png"
            width={1852}
          />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Current Acuity portal · Seven-day aggregate practice view
        </p>
      </div>
    </section>
  );
}
