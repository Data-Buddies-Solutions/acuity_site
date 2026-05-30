import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import BookCallButton from "@/app/components/BookCallButton";
import { Button } from "@/app/components/ui/button";
import { SITE_CONFIG } from "@/lib/config";
import { getPressReleaseBySlug, pressReleases } from "../posts";

type Params = { slug: string };

export function generateStaticParams() {
  return pressReleases.map((release) => ({ slug: release.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const release = getPressReleaseBySlug(slug);

  if (!release) {
    return {
      title: "Press release not found",
    };
  }

  const url = `${SITE_CONFIG.baseUrl}/press/${release.slug}`;

  return {
    title: release.headline,
    description: release.summary,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: release.headline,
      description: release.summary,
      url,
      siteName: SITE_CONFIG.name,
      publishedTime: release.date,
      images: [
        {
          url: `${SITE_CONFIG.baseUrl}/api/og`,
          width: 1200,
          height: 630,
          alt: release.headline,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: release.headline,
      description: release.summary,
      images: [`${SITE_CONFIG.baseUrl}/api/og`],
    },
  };
}

export default async function PressReleasePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const release = getPressReleaseBySlug(slug);

  if (!release) {
    notFound();
  }

  const url = `${SITE_CONFIG.baseUrl}/press/${release.slug}`;

  const newsArticleSchema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: release.headline,
    description: release.summary,
    datePublished: release.date,
    dateModified: release.date,
    url,
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
        url: `${SITE_CONFIG.baseUrl}/logo.png`,
      },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Press", url: "/press" },
          { name: release.headline, url: `/press/${release.slug}` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(newsArticleSchema) }}
      />

      <article className="bg-background py-20 md:py-28">
        <div className="mx-auto max-w-3xl px-6">
          <Link
            href="/press"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            All press releases
          </Link>

          <p className="mt-10 text-xs font-semibold uppercase tracking-[0.22em] text-accent">
            For immediate release
          </p>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" aria-hidden />
            {release.dateline}
          </div>

          <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl [text-wrap:balance]">
            {release.headline}
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
            {release.summary}
          </p>

          <div className="mt-12 space-y-10">
            {release.body.map((section, i) => (
              <div key={i}>
                {section.heading && (
                  <h2 className="text-xl font-semibold tracking-tight text-neutral-900 md:text-2xl">
                    {section.heading}
                  </h2>
                )}
                <div className="mt-3 space-y-4">
                  {section.paragraphs.map((p, j) => (
                    <p
                      key={j}
                      className="text-base leading-relaxed text-neutral-700"
                    >
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {release.quote && (
            <figure className="mt-12 rounded-2xl border border-neutral-200 bg-muted/40 p-8">
              <blockquote className="text-lg italic leading-relaxed text-neutral-800 md:text-xl">
                &ldquo;{release.quote.text}&rdquo;
              </blockquote>
              <figcaption className="mt-4 text-sm text-muted-foreground">
                — <span className="font-semibold text-neutral-900">{release.quote.attribution}</span>
                , {release.quote.role}
              </figcaption>
            </figure>
          )}

          {release.relatedUrl && (
            <div className="mt-12">
              <Button
                asChild
                variant="secondary"
                className="rounded-full border border-neutral-300 bg-white px-7 py-3 text-neutral-800 shadow-sm"
              >
                <Link href={release.relatedUrl.href}>
                  {release.relatedUrl.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}

          <div className="mt-16 border-t border-neutral-200 pt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              About Acuity Health
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Acuity Health is the AI receptionist for ophthalmology practices. Acuity
              answers every patient call, books appointments directly into the EMR, and
              captures after-hours demand — so practices never miss a call. Learn more at{" "}
              <Link
                href="/"
                className="text-foreground underline-offset-4 hover:underline"
              >
                acuityhealth.io
              </Link>
              .
            </p>

            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Press contact
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {release.contact.name}
              <br />
              <Link
                href={`mailto:${release.contact.email}`}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {release.contact.email}
              </Link>
            </p>
          </div>

          <div className="mt-16 rounded-[2rem] border border-neutral-200 bg-white p-8 text-center md:p-10">
            <h2 className="text-2xl font-semibold tracking-tight">
              See Acuity on a live call.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
              Book a 30-minute demo and we&apos;ll run it on your scheduling rules.
            </p>
            <div className="mt-6">
              <BookCallButton
                size="default"
                className="rounded-full px-7 py-3"
                iconVariant="arrow-right"
              >
                Book a Demo
              </BookCallButton>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
