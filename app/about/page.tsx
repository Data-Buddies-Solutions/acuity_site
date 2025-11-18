import type { Metadata } from "next";
import Image from "next/image";
import { Zap, Target, Users } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import { SITE_CONFIG } from "@/lib/config";

// X (formerly Twitter) logo SVG component
function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const team = [
  {
    name: "Kyle Shechtman",
    role: "CEO",
    initials: "KS",
    image: "/kyle-shechtman.png",
    bio: "Hi, I'm Kyle, the CEO of Data Buddies. I love talking with business owners, learning what slows them down, and building better ways to get things done. I track new technology closely and enjoy turning big ideas into something real alongside the team. For me, work should feel less complicated and more meaningful, whether that means sharper systems, smarter tools, or a fresh perspective. When I'm away from the laptop, you'll find me outside hiking, playing sports, exploring new places, and staying curious about what's next.",
    twitter: "_kyleshechtman",
  },
  {
    name: "Chase Fagen",
    role: "CTO",
    initials: "CF",
    image: "/chase-fagen.png",
    bio: "I'm a lifelong learner and adventurer, fascinated by how ideas move from circuits and code to things that actually make a difference in people's lives. I love all sports and competition, from snowboarding to soccer to padel, I have tried it all. I see movement in sport the same way I see it in business: it's about flow, timing, and adaptability. That same competitive spirit drives me to find better ways for small businesses to win, because when their tools move with them instead of against them, that's a victory we share.",
    twitter: "chasef07",
  },
];

const philosophy = [
  {
    icon: Zap,
    title: "Demo, learn, build",
    description:
      "Quick demos, fast feedback, continuous improvement. Building your perfect product.",
  },
  {
    icon: Target,
    title: "Build for business impact",
    description:
      "We build what matters: solutions that boost revenue, save hours, or enable growth.",
  },
  {
    icon: Users,
    title: "Simple by design",
    description:
      "We design with your team in mind, so nothing feels complicated.",
  },
];

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Meet Data Buddies Solutions, the AI automation team behind workflow blueprints, agent orchestration, and continuous optimization for growing businesses.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/about`,
  },
};

export default function AboutPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "About Us", url: "/about" },
        ]}
      />

      {/* About Us */}
      <section className="border-b pt-12 md:pt-16 pb-20 md:pb-32">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <div className="mx-auto mb-12 md:mb-16 max-w-3xl space-y-6 text-center">
            <Badge variant="outline" className="backdrop-blur-sm bg-background/60 border-border text-sm font-medium uppercase tracking-tight">
              About Us
            </Badge>
            <h1 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
              Meet The Data Buddies
            </h1>
            <p className="text-xl text-muted-foreground md:text-2xl">
              We help teams automate work so they can focus on growth
            </p>
          </div>
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2 lg:gap-16">
            {team.map(({ name, role, initials, image, bio, twitter }) => (
              <div key={name} className="flex flex-col items-center text-center space-y-6">
                {image ? (
                  <div className="relative h-48 w-48 rounded-full overflow-hidden shadow-lg">
                    <Image
                      src={image}
                      alt={name}
                      fill
                      className="object-cover"
                      sizes="192px"
                    />
                  </div>
                ) : (
                  <div className="flex h-48 w-48 items-center justify-center rounded-full bg-gradient-to-br from-accent via-accent/90 to-accent/70 text-4xl font-semibold text-white shadow-lg">
                    {initials}
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-2xl font-bold tracking-tight">{name}</h3>
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{role}</p>
                    {twitter && (
                      <a
                        href={`https://x.com/${twitter}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:text-accent-hover transition-colors"
                      >
                        <XLogo className="h-3 w-3" />
                        @{twitter}
                      </a>
                    )}
                  </div>
                  <p className="text-base leading-relaxed text-muted-foreground">{bio}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Philosophy */}
      <section className="py-20 md:py-32 bg-accent/5">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <div className="mx-auto mb-16 md:mb-20 max-w-3xl space-y-6 text-center">
            <h2 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
              Our Philosophy
            </h2>
            <p className="text-xl text-muted-foreground md:text-2xl">
              The principles that guide every project
            </p>
          </div>
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-3 lg:gap-16">
            {philosophy.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex flex-col items-center text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-accent/90 to-accent/70 shadow-lg">
                  <Icon className="h-8 w-8 text-white" aria-hidden />
                </div>
                <h3 className="text-xl font-bold tracking-tight">{title}</h3>
                <p className="text-base text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
