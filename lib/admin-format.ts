const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

export function formatAdminDateTime(date: Date | string | null | undefined) {
  if (!date) {
    return "No activity";
  }

  return dateTimeFormatter.format(new Date(date));
}

export function formatShortDate(date: Date | string | null | undefined) {
  if (!date) {
    return "--";
  }

  return shortDateFormatter.format(new Date(date));
}

export function formatDuration(secs: number | null | undefined) {
  const value = Math.max(0, Math.round(secs ?? 0));
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatLatencyMs(ms: number | null | undefined) {
  const value = Math.max(0, Math.round(ms ?? 0));

  if (value <= 0) {
    return "--";
  }

  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

export function formatCostMicros(costMicros: number | null | undefined) {
  const dollars = (costMicros ?? 0) / 1_000_000;

  if (dollars <= 0) {
    return "$0.00";
  }

  if (dollars < 1) {
    return `$${dollars.toFixed(3)}`;
  }

  return `$${dollars.toFixed(2)}`;
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) {
    return "--";
  }

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone;
}

export function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "--";
  }

  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

export function formatRate(rate: number | null | undefined) {
  const value = rate ?? 0;

  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(1)}%`;
}
