import type { Metadata } from "next";
import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return [];
}

export async function generateMetadata(_: PageProps): Promise<Metadata> {
  return {
    title: "Insights",
  };
}

export default async function BlogPostPage(_: PageProps) {
  redirect("/insights");
}
