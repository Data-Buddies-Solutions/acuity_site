import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Home, Search } from "lucide-react";
import { SITE_CONFIG } from "@/lib/config";

export const metadata = {
  title: "Page Not Found",
  description: "The page you're looking for doesn't exist. Explore Acuity Health's patient access and engagement services for eye care practices.",
  alternates: {
    canonical: `${SITE_CONFIG.baseUrl}/404`,
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <section className="min-h-[60vh] flex items-center justify-center py-16 md:py-24">
      <div className="mx-auto max-w-2xl space-y-8 px-4 text-center">
        <Badge variant="outline" className="text-sm font-medium uppercase">
          Error 404
        </Badge>
        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tighter md:text-5xl lg:text-6xl">
            Page Not Found
          </h1>
          <p className="text-xl text-muted-foreground md:text-2xl">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center pt-4">
          <Button asChild size="lg" className="rounded-xl">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg" className="rounded-xl">
            <Link href="/insights">
              <Search className="mr-2 h-4 w-4" />
              Browse Insights
            </Link>
          </Button>
        </div>

        <div className="pt-8 space-y-4">
          <p className="text-sm text-muted-foreground">Popular pages:</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/about" className="text-sm text-accent hover:underline">
              About Us
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link href="/faq" className="text-sm text-accent hover:underline">
              FAQ
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link href="/insights" className="text-sm text-accent hover:underline">
              Insights
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link href={SITE_CONFIG.calendarLink} className="text-sm text-accent hover:underline" target="_blank" rel="noopener noreferrer">
              Book a Call
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
