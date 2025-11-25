'use client';

import { useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { AlertCircle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <section className="min-h-[60vh] flex items-center justify-center py-16 md:py-24">
      <div className="mx-auto max-w-2xl space-y-8 px-4 text-center">
        <Badge variant="outline" className="text-sm font-medium uppercase bg-red-50 text-red-600 border-red-200">
          Error
        </Badge>
        <div className="space-y-4">
          <div className="flex justify-center">
            <AlertCircle className="h-16 w-16 text-red-500" />
          </div>
          <h1 className="text-4xl font-bold tracking-tighter md:text-5xl">
            Something went wrong
          </h1>
          <p className="text-xl text-muted-foreground md:text-2xl">
            We encountered an unexpected error. Our team has been notified.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center pt-4">
          <Button onClick={reset} size="lg" className="rounded-xl">
            Try Again
          </Button>
          <Button asChild variant="secondary" size="lg" className="rounded-xl">
            <a href="/">Go Home</a>
          </Button>
        </div>

        <div className="pt-8">
          <p className="text-sm text-muted-foreground">
            Need help?{' '}
            <a href="mailto:team@databuddiessolutions.com" className="text-accent hover:underline">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
