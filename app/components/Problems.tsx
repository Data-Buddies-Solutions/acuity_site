import { AlarmClock, BarChart3, ClipboardList } from "lucide-react";

import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const challenges = [
  {
    icon: AlarmClock,
    title: "You're stuck doing the same tasks over and over",
    description:
      "Answering the same customer questions. Copying data between systems. Tasks that take hours but don't grow your business.",
  },
  {
    icon: ClipboardList,
    title: "Important work falls through the cracks",
    description:
      "Following up with leads, processing orders on time, keeping customer records updated. It's hard to stay on top of everything.",
  },
  {
    icon: BarChart3,
    title: "You're working harder, not smarter",
    description:
      "Your to-do list keeps growing, but you can't afford to hire more help. You need leverage, not just more hours in the day.",
  },
];

export default function Problems() {
  return (
    <section className="border-b py-20 md:py-32 bg-muted/50" id="problems">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mx-auto mb-16 md:mb-20 max-w-3xl space-y-6 text-center">
          <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
            Sound familiar?
          </Badge>
          <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
            Does This Sound Like<br />Your <span className="text-accent">Day-to-Day</span>?
          </h2>
          <p className="text-xl text-muted-foreground md:text-2xl">
            You&apos;re not alone. These are the exact problems we help small businesses solve with AI
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
