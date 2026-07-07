import type { Metadata } from "next";

import SpecialtyPage from "@/app/specialties/SpecialtyPage";
import { getSpecialtyPage } from "@/app/specialties/pages";
import { SITE_CONFIG } from "@/lib/config";

const page = getSpecialtyPage("specialties/dermatology")!;

export const metadata: Metadata = {
  title: page.title,
  description: page.description,
  keywords: page.keywords,
  alternates: { canonical: `${SITE_CONFIG.baseUrl}/${page.slug}` },
  openGraph: {
    type: "website",
    title: `${page.title} | ${SITE_CONFIG.name}`,
    description: page.description,
    url: `${SITE_CONFIG.baseUrl}/${page.slug}`,
    siteName: SITE_CONFIG.name,
    images: [`${SITE_CONFIG.baseUrl}/api/og`],
  },
  twitter: {
    card: "summary_large_image",
    title: `${page.title} | ${SITE_CONFIG.name}`,
    description: page.description,
    images: [`${SITE_CONFIG.baseUrl}/api/og`],
  },
};

export default function DermatologySpecialtyPage() {
  return <SpecialtyPage page={page} />;
}
