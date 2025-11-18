import { AlarmClock, BarChart3, ClipboardList } from "lucide-react";

import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const challenges = [
  {
    icon: AlarmClock,
    title: "Time wasted on repetitive tasks",
    description:
      "Your team spends hours on manual work that could be automated.",
  },
  {
    icon: BarChart3,
    title: "Data you can't access or use",
    description:
      "Critical insights are trapped in spreadsheets and disconnected tools.",
  },
  {
    icon: ClipboardList,
    title: "Processes that don't scale",
    description:
      "What worked at 10 customers breaks at 100.",
  },
];

export default function Problems() {
  return (
    <section className="border-b py-20 md:py-32 bg-accent/5" id="problems">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mx-auto mb-16 md:mb-20 max-w-3xl space-y-6 text-center">
          <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
            Why teams call us
          </Badge>
          <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
            Running Into These Walls?
          </h2>
          <p className="text-xl text-muted-foreground md:text-2xl">
            We turn bottlenecks into breakthroughs with AI automation
          </p>
        </div>
        <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-3 lg:gap-16">
          {challenges.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-accent/90 to-accent/70 shadow-lg">
                <Icon className="h-8 w-8 text-white" aria-hidden />
              </div>
              <h3 className="text-xl font-bold tracking-tight">{title}</h3>
              <p className="text-base text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
