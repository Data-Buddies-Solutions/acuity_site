import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
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
  const imageUrl = release.image
    ? `${SITE_CONFIG.baseUrl}${release.image.src}`
    : `${SITE_CONFIG.baseUrl}/api/og`;

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
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: release.image?.alt ?? release.headline,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: release.headline,
      description: release.summary,
      images: [imageUrl],
    },
  };
}

export default async function PressReleasePage({ params }: { params: Promise<Params> }) {
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
        url: SITE_CONFIG.logoUrl,
      },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    ...(release.image
      ? { image: `${SITE_CONFIG.baseUrl}${release.image.src}` }
      : {}),
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

      <article className="bg-background pt-6 pb-20 md:pt-10 md:pb-28">
        <div className="mx-auto max-w-3xl px-6">
          <Link
            href="/press"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            All press releases
          </Link>

          {/* Hero */}
          <header
            className={
              release.image
                ? "mt-8 grid gap-6 md:mt-10 md:grid-cols-[minmax(0,1fr)_14rem] md:items-start md:gap-10"
                : "mt-8 md:mt-10"
            }
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-1 font-semibold uppercase tracking-[0.18em] text-accent">
                  For immediate release
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {release.dateline}
                </span>
              </div>

              <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl [text-wrap:balance]">
                {release.headline}
              </h1>

              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                {release.summary}
              </p>
            </div>

            {release.image && (
              <figure className="md:pt-1">
                <div className="relative aspect-[4/5] w-44 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 shadow-sm md:w-full">
                  <Image
                    src={release.image.src}
                    alt={release.image.alt}
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 768px) 176px, 224px"
                    priority
                  />
                </div>
                <figcaption className="mt-3 text-xs text-muted-foreground">
                  {release.image.alt}
                </figcaption>
              </figure>
            )}
          </header>

          {/* Body */}
          <div className="mt-12 space-y-8">
            {release.body.map((section, i) => (
              <section key={i}>
                {section.heading && (
                  <h2 className="text-xl font-semibold tracking-tight text-neutral-900 md:text-2xl">
                    {section.heading}
                  </h2>
                )}
                <div className={section.heading ? "mt-3 space-y-4" : "space-y-4"}>
                  {section.paragraphs.map((p, j) => (
                    <p key={j} className="text-[1.0625rem] leading-[1.75] text-neutral-700">
                      {p}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {release.quote && (
            <figure className="mt-12 border-l-2 border-accent pl-6">
              <blockquote className="text-xl leading-[1.5] text-neutral-900 md:text-2xl [text-wrap:balance]">
                &ldquo;{release.quote.text}&rdquo;
              </blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold text-neutral-900">
                  {release.quote.attribution}
                </span>
                <span className="text-muted-foreground">, {release.quote.role}</span>
              </figcaption>
            </figure>
          )}

          {release.relatedUrl && (
            <div className="mt-10">
              <Button
                asChild
                variant="secondary"
                className="rounded-full border border-neutral-300 bg-white px-6 py-3 text-neutral-800 shadow-sm hover:bg-neutral-50"
              >
                <Link href={release.relatedUrl.href}>
                  {release.relatedUrl.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}

          {/* About + contact */}
          <div className="mt-16 grid gap-8 border-t border-neutral-200 pt-8 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                About Acuity Health
              </p>
              <p className="mt-3 text-sm leading-relaxed text-neutral-700">
                Acuity Health is the AI receptionist for ophthalmology practices.
                Acuity answers every patient call, books appointments directly into the
                EMR, and captures after-hours demand.{" "}
                <Link
                  href="/"
                  className="text-neutral-900 underline-offset-4 hover:underline"
                >
                  acuityhealth.io
                </Link>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Press contact
              </p>
              <p className="mt-3 text-sm leading-relaxed text-neutral-700">
                {release.contact.name}
                <br />
                <Link
                  href={`mailto:${release.contact.email}`}
                  className="text-neutral-900 underline-offset-4 hover:underline"
                >
                  {release.contact.email}
                </Link>
              </p>
            </div>
          </div>

        </div>
      </article>
    </>
  );
}
