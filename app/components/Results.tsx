"use client";

const stats = [
  {
    value: "40%",
    label: "Less admin time",
  },
  {
    value: "60%",
    label: "Fewer no-shows",
  },
  {
    value: "3x",
    label: "Faster pre-auths",
  },
  {
    value: "24/7",
    label: "Availability",
  },
];

export default function Results() {
  return (
    <section className="py-20 md:py-28 bg-muted" id="results">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
            What practices see
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Typical results from practices working with Data Buddies Solutions
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-4xl md:text-5xl font-semibold text-foreground mb-2">{stat.value}</p>
              <p className="text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-12">
          Results vary by practice. Based on typical client outcomes.
        </p>
      </div>
    </section>
  );
}
