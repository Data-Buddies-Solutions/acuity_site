import { CalendarCheck2, Headphones, ListTodo } from "lucide-react";

const outcomes = [
  {
    title: "Answers every call",
    description:
      "Picks up immediately, understands the request, and gives patients a clear next step at any hour.",
    Icon: Headphones,
  },
  {
    title: "Books directly into the EMR",
    description:
      "Matches the right location, provider, visit type, and scheduling rules without double entry.",
    Icon: CalendarCheck2,
  },
  {
    title: "Creates follow-up tasks for staff",
    description:
      "When a request needs a person, Acuity creates a clear task with the call context and next step.",
    Icon: ListTodo,
  },
] as const;

export default function OfferStory() {
  return (
    <section className="bg-canvas py-20 md:py-28" id="product">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-label text-[11px] font-medium tracking-[0.16em] text-accent">
            One receptionist, end to end
          </p>
          <h2 className="mt-5 text-4xl leading-[1.05] md:text-5xl lg:text-[3.5rem] [text-wrap:balance]">
            The work gets done before staff has to step in.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Acuity completes routine patient access work and makes the exceptions obvious.
          </p>
        </div>

        <div className="mt-14 grid divide-y divide-[#d9dfe8] border-y border-[#d9dfe8] md:mt-18 md:grid-cols-3 md:divide-x md:divide-y-0">
          {outcomes.map(({ description, Icon, title }) => (
            <article className="px-2 py-9 md:px-8 md:py-10" key={title}>
              <Icon
                aria-hidden="true"
                className="size-5 text-accent"
                strokeWidth={1.75}
              />
              <h3 className="mt-5 text-2xl leading-tight text-[#101820]">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
                {description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
