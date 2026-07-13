import Link from "next/link";

const proofPoints = [
  {
    context: "Before Acuity",
    metric: "~200",
    label: "patient calls were going unanswered each week",
  },
  {
    context: "First week live",
    metric: "200",
    label: "appointments booked directly into the EMR",
  },
] as const;

const businessOutcomes = [
  {
    title: "Patient demand captured",
    description:
      "Calls become booked appointments, completed cancellations, or a clear next step instead of another voicemail to return.",
  },
  {
    title: "Staff time protected",
    description:
      "Acuity handles the routine work so staff can focus on the patients in front of them and the tasks that need a person.",
  },
] as const;

export default function ProofNarrative() {
  return (
    <section className="bg-[#172033] py-20 text-white md:py-28" id="proof">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-white/65">
            Verified operating results
          </p>
          <h2 className="mt-5 text-4xl leading-[1.05] text-white md:text-5xl lg:text-[3.5rem] [text-wrap:balance]">
            More patients booked. Less work for the front desk.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#d8dee8] md:text-lg">
            In its first week, Acuity booked 200 appointments directly into the EMR while
            handling the routine scheduling work that pulls staff away from patients.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl gap-px overflow-hidden rounded-xl bg-white/12 md:mt-20 md:grid-cols-2">
          {proofPoints.map((point) => (
            <div
              className="bg-[#172033] px-6 py-10 text-center md:px-10 md:py-12"
              key={point.context}
            >
              <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-white/55">
                {point.context}
              </p>
              <p className="mt-5 font-display text-6xl font-medium tracking-[-0.052em] text-white tabular-nums md:text-7xl">
                {point.metric}
              </p>
              <p className="mx-auto mt-3 max-w-[24ch] text-sm leading-relaxed text-white/68 md:text-base">
                {point.label}
              </p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-8 border-t border-white/12 pt-10 md:grid-cols-2 md:gap-12">
          {businessOutcomes.map((outcome) => (
            <div key={outcome.title}>
              <h3 className="text-xl text-white">{outcome.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/65 md:text-base">
                {outcome.description}
              </p>
            </div>
          ))}
        </div>

        <figure className="mx-auto mt-20 max-w-3xl border-t border-white/12 pt-14 text-center md:mt-24 md:pt-16">
          <blockquote className="text-2xl leading-[1.35] text-white md:text-3xl lg:text-[2.15rem] [text-wrap:balance]">
            “I was spending 4+ hours a day on manual admin work. Acuity gave me my life
            back.”
          </blockquote>
          <figcaption className="mt-7 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="font-semibold text-white">Jason Buchwald, MD</span>
            <span className="text-white/35">·</span>
            <span className="text-white/65">OnlineDoctorNote</span>
          </figcaption>
          <Link
            className="mt-7 inline-flex text-sm font-medium text-[#d8dee8] underline decoration-white/25 underline-offset-4 hover:text-white"
            href="/press/acuity-health-launches-ai-receptionist-ophthalmology"
          >
            Read the deployment release
          </Link>
        </figure>
      </div>
    </section>
  );
}
