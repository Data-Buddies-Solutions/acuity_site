import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Clock } from "lucide-react";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import BookCallButton from "@/app/components/BookCallButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelContent } from "@/components/ui/panel";
import { Separator } from "@/components/ui/separator";
import { SITE_CONFIG } from "@/lib/config";
import { getInsightBySlug, insightPosts } from "../posts";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return insightPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getInsightBySlug(slug);

  if (!post) {
    return { title: "Insight not found" };
  }

  const url = `${SITE_CONFIG.baseUrl}/insights/${post.slug}`;

  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      siteName: SITE_CONFIG.name,
      publishedTime: post.date,
      authors: [SITE_CONFIG.name],
      tags: post.tags,
      images: [
        {
          url: `${SITE_CONFIG.baseUrl}/api/og`,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [`${SITE_CONFIG.baseUrl}/api/og`],
    },
  };
}

export default async function InsightPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getInsightBySlug(slug);

  if (!post) {
    notFound();
  }

  const formattedDate = new Date(`${post.date}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const url = `${SITE_CONFIG.baseUrl}/insights/${post.slug}`;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    url,
    keywords: post.tags.join(", "),
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: {
      "@type": "Organization",
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.baseUrl,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_CONFIG.name,
      logo: {
        "@type": "ImageObject",
        url: SITE_CONFIG.logoUrl,
      },
    },
  };

  return (
    <article className="section bg-background">
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Insights", url: "/insights" },
          { name: post.title, url: `/insights/${post.slug}` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <div className="space-y-6">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link href="/insights">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to insights
            </Link>
          </Button>
          <div className="space-y-4">
            <Badge className="w-fit">{formattedDate}</Badge>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              {post.title}
            </h1>
            <p className="text-base text-foreground/70 md:text-lg">{post.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-foreground/60">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4" aria-hidden />
              {formattedDate}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4" aria-hidden />
              {post.readingTime}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-foreground/50">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-accent/10 px-3 py-1 text-accent">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <Separator className="bg-border/70" />
        <div className="space-y-12">
          {post.sections.map((section) => (
            <section key={section.heading} className="space-y-4">
              <h2 className="text-2xl font-semibold text-foreground">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, idx) => (
                <p
                  key={`${section.heading}-${idx}`}
                  className="text-base leading-relaxed text-foreground/80"
                >
                  {paragraph}
                </p>
              ))}
              {section.bullets && (
                <ul className="space-y-2 border-l-2 border-accent/50 pl-4 text-sm text-foreground/75">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
              {section.links && (
                <div className="flex flex-col gap-2 pt-1">
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="inline-flex w-fit items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover"
                    >
                      {link.label}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
        <Panel className="border-accent/30 bg-accent/10">
          <PanelContent className="space-y-4 p-6">
            <h3 className="text-xl font-semibold text-accent">Key takeaway</h3>
            <p className="text-base text-foreground/80">{post.takeaway}</p>
            <BookCallButton
              iconVariant="arrow-up-right"
              className="w-fit bg-accent text-white hover:bg-accent-hover"
            >
              Book a strategy session
            </BookCallButton>
          </PanelContent>
        </Panel>
      </div>
    </article>
  );
}
