export default function Loading() {
  return (
    <section className="min-h-[60vh] flex items-center justify-center py-16">
      <div className="flex flex-col items-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-accent border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </section>
  );
}
