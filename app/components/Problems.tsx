import { AlarmClock, BarChart3, ClipboardList } from "lucide-react";

import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const challenges = [
  {
    icon: AlarmClock,
    title: "Discover AI opportunities",
    description:
      "We identify high-impact use cases specific to your business.",
  },
  {
    icon: BarChart3,
    title: "Insights buried in databases",
    description:
      "Your data holds revenue opportunities waiting to be discovered.",
  },
  {
    icon: ClipboardList,
    title: "Eliminate repetitive work",
    description:
      "Free your team from manual tasks that slow growth.",
  },
];

export default function Problems() {
  return (
    <section className="py-16 md:py-24" id="problems">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="mx-auto mb-16 max-w-3xl space-y-4 text-center">
          <Badge variant="outline" className="text-sm font-medium uppercase">
            Why teams call us
          </Badge>
          <h2 className="text-3xl font-semibold md:text-4xl lg:text-5xl">
            The hidden costs of running without automation
          </h2>
          <p className="text-lg text-foreground/75 md:text-xl">
            We audit your workflows and build AI automations that eliminate friction and boost revenue
          </p>
        </div>
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3 md:gap-12">
          {challenges.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent via-accent/90 to-accent/70">
                <Icon className="h-8 w-8 text-white" aria-hidden />
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
