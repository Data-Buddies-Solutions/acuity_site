import type { Metadata } from "next";

import SolutionPage from "@/app/solutions/SolutionPage";
import { getSolutionPage } from "@/app/solutions/pages";
import { SITE_CONFIG } from "@/lib/config";

const page = getSolutionPage("advancedmd-ai-receptionist")!;

export const metadata: Metadata = {
  title: page.title,
  description: page.description,
  keywords: page.keywords,
  alternates: { canonical: `${SITE_CONFIG.baseUrl}/${page.slug}` },
};

export default function AdvancedMdAiReceptionistPage() {
  return <SolutionPage page={page} />;
}
