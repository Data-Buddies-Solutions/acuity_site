import type { Metadata } from "next";

import BreadcrumbSchema from "@/app/components/BreadcrumbSchema";
import { SITE_CONFIG } from "@/lib/config";

import AdvancedMdLanding from "./AdvancedMdLanding";

const TITLE = "Acuity × AdvancedMD: The AI Receptionist for Ophthalmology";
const DESCRIPTION =
  "Acuity is the AI receptionist built for AdvancedMD ophthalmology practices. Answer every call, book directly into AdvancedMD, and capture after-hours demand. Now available on the AdvancedMD Marketplace.";
const CANONICAL = `${SITE_CONFIG.baseUrl}/partners/advancedmd`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "AdvancedMD AI receptionist",
    "AdvancedMD integration",
    "AI receptionist for ophthalmology",
    "ophthalmology receptionist software",
    "AdvancedMD scheduling integration",
    "AMD marketplace AI",
    "eye care AI front desk",
    "ophthalmology phone automation",
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    siteName: "Acuity Health",
    type: "website",
    images: [
      {
        url: `${SITE_CONFIG.baseUrl}/api/og`,
        width: 1200,
        height: 630,
        alt: "Acuity Health × AdvancedMD partnership",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_CONFIG.baseUrl}/api/og`],
  },
};

export default function AdvancedMdPartnerPage() {
  const partnershipJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Acuity AI Receptionist for AdvancedMD",
    description: DESCRIPTION,
    brand: { "@type": "Brand", name: "Acuity Health" },
    url: CANONICAL,
    category: "Healthcare AI / Patient Engagement",
    isRelatedTo: {
      "@type": "Organization",
      name: "AdvancedMD",
      url: "https://www.advancedmd.com",
    },
  };

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: SITE_CONFIG.baseUrl },
          { name: "Partners", url: `${SITE_CONFIG.baseUrl}/partners` },
          { name: "AdvancedMD", url: CANONICAL },
        ]}
      />
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(partnershipJsonLd) }}
        type="application/ld+json"
      />
      <AdvancedMdLanding />
    </>
  );
}
