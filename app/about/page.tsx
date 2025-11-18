import type { Metadata } from "next";

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
    bio: "Hi, I'm Kyle, the CEO of Data Buddies. I love talking with business owners, learning what slows them down, and building better ways to get things done. I track new technology closely and enjoy turning big ideas into something real alongside the team. For me, work should feel less complicated and more meaningful, whether that means sharper systems, smarter tools, or a fresh perspective. When I'm away from the laptop, you'll find me outside hiking, playing sports, exploring new places, and staying curious about what's next.",
    twitter: "_kyleshechtman",
  },
  {
    name: "Chase Fagen",
    role: "CTO",
    initials: "CF",
    bio: "I'm a lifelong learner and adventurer, fascinated by how ideas move from circuits and code to things that actually make a difference in people's lives. I love all sports and competition, from snowboarding to soccer to padel, I have tried it all. I see movement in sport the same way I see it in business: it's about flow, timing, and adaptability. That same competitive spirit drives me to find better ways for small businesses to win, because when their tools move with them instead of against them, that's a victory we share.",
    twitter: "chasef07",
  },
];

const philosophy = [
  {
    title: "Ship, learn, iterate",
    description:
      "We launch quickly, listen closely, and polish the experience so wins keep stacking up.",
  },
  {
    title: "Build for business impact",
    description:
      "We only build when the outcome is clear: more revenue, fewer hours, or smoother scale, so every automation pulls its weight.",
  },
  {
    title: "Keep it effortless",
    description:
      "We involve the people doing the work so every automation stays simple, seamless, and clearly on your side.",
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
    <section className="py-16 md:py-24">
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "About Us", url: "/about" },
        ]}
      />
      <div className="mx-auto max-w-screen-xl space-y-16 px-4">
        <div className="space-y-16">
          <div className="mx-auto max-w-3xl space-y-4 text-center">
            <Badge variant="outline" className="text-sm font-medium uppercase">
              About Us
            </Badge>
            <h1 className="text-3xl font-semibold md:text-4xl lg:text-5xl">Fortune 500 experience meets cutting-edge AI</h1>
            <p className="text-lg text-foreground/75 md:text-xl">
              Enterprise-grade automation built specifically for small businesses, without the enterprise complexity
            </p>
          </div>
          <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3 md:gap-12">
            <div className="flex flex-col items-center text-center space-y-4">
              <h3 className="text-xl font-semibold">Proven at Scale</h3>
              <p className="text-base text-foreground/75">
                We built systems at Fortune 500 tech companies before leaving to focus on the frontier of AI automation
              </p>
            </div>
            <div className="flex flex-col items-center text-center space-y-4">
              <h3 className="text-xl font-semibold">Full-Stack AI Expertise</h3>
              <p className="text-base text-foreground/75">
                From models and hardware to software, applications, and the investment landscape, we understand the entire AI ecosystem
              </p>
            </div>
            <div className="flex flex-col items-center text-center space-y-4">
              <h3 className="text-xl font-semibold">Business + Engineering DNA</h3>
              <p className="text-base text-foreground/75">
                With degrees spanning business and engineering, we combine business thinking with deep technical expertise to convert challenges into wins
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-12">
          <div className="mx-auto max-w-3xl space-y-3 text-center">
            <h2 className="text-3xl font-semibold md:text-4xl">Meet the team</h2>
            <p className="text-lg text-foreground/75">
              Data Buddies helps lean teams boost revenue, clear bottlenecks, and win back time with AI that feels simple, useful, and human
            </p>
          </div>
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2">
            {team.map(({ name, role, initials, bio, twitter }) => (
              <div key={name} className="flex flex-col items-center text-center space-y-6">
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-accent via-accent/90 to-accent/70 text-2xl font-semibold text-white">
                  {initials}
                </div>
                <div className="space-y-3">
                  <div>
                    <h3 className="text-2xl font-semibold text-foreground">{name}</h3>
                    <p className="text-sm font-medium uppercase tracking-wide text-foreground/60">{role}</p>
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
                  <p className="text-base leading-relaxed text-foreground/75">{bio}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-12">
          <div className="mx-auto max-w-3xl space-y-3 text-center">
            <h2 className="text-3xl font-semibold md:text-4xl">Our philosophy</h2>
            <p className="text-lg text-foreground/75">
              These principles keep every automation grounded in business impact and human adoption even as tools change and your priorities evolve
            </p>
          </div>
          <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3 md:gap-12">
            {philosophy.map(({ title, description }) => (
              <div key={title} className="flex flex-col items-center text-center space-y-4">
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="text-base text-foreground/75">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
