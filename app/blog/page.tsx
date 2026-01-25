import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Clock } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { posts } from "./posts";
import { SITE_CONFIG } from "@/lib/config";
import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";

export const metadata: Metadata = {
  title: "Automation Insights & Playbooks",
  description:
    "Deep dives, frameworks, and checklists for building AI automations that help small businesses scale.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/blog`,
  },
};

export default function BlogPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Blog", url: "/blog" },
        ]}
      />
      <div className="py-16 md:py-24">
      <div className="mx-auto max-w-screen-xl space-y-12 px-4">
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <h1 className="text-3xl font-semibold md:text-4xl lg:text-5xl">
            Playbooks for launching AI automations that move the needle
          </h1>
        </div>
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 lg:grid-cols-3">
          {posts.map(({ slug, title, description, readingTime, date, tags }) => (
            <div key={slug} className="flex flex-col space-y-4 rounded-2xl border border-border/40 p-6 transition hover:border-accent/40">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="text-base text-foreground/75">
                  {description}
                </p>
              </div>
              <div className="mt-auto space-y-4">
                <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-wide text-foreground/50">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    {new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {readingTime}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <Button asChild variant="secondary" className="w-full rounded-full">
                  <Link href={`/blog/${slug}`}>
                    Read article
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-foreground/60">
          Looking for something specific? Email{" "}
          <Link href="mailto:team@databuddiessolutions.com" className="text-accent hover:text-accent-hover transition-colors">
            team@databuddiessolutions.com
          </Link>{" "}
          with your topic request
        </p>
      </div>
      </div>
    </>
  );
}
