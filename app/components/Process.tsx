import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle } from "./ui/card";

const steps = [
  {
    step: "1",
    title: "Understand & plan",
    description:
      "We hear your problems, discover where bottlenecks are, and use our AI expertise to see where we can help.",
  },
  {
    step: "2",
    title: "Build & test",
    description:
      "We connect the tools, build the automations, and test them in a safe space so everything feels right before launch.",
  },
  {
    step: "3",
    title: "Launch & coach",
    description:
      "We deploy the automation, train your team, and provide support until adoption is seamless.",
  },
  {
    step: "4",
    title: "Tune & grow",
    description:
      "We monitor performance, optimize what's working, and scale with new automations.",
  },
];

export default function Process() {
  return (
    <section className="py-16 md:py-24" id="process">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="mx-auto mb-16 max-w-3xl space-y-4 text-center">
          <Badge variant="outline" className="text-sm font-medium uppercase">
            Delivery framework
          </Badge>
          <h2 className="text-3xl font-semibold md:text-4xl lg:text-5xl">
            Discovery to deployment in four steps
          </h2>
          <p className="text-lg text-foreground/75 md:text-xl">
            A clear process that gets AI automations working fast
          </p>
        </div>
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-12">
          {steps.map(({ step, title, description }) => (
            <div key={title} className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent via-accent/90 to-accent/70">
                <span className="text-2xl font-semibold text-white">{step}</span>
              </div>
              <h3 className="text-xl font-semibold">{title}</h3>
              <p className="text-base text-foreground/75">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
