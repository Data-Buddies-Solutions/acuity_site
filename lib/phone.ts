export function phoneDigits(phone: string | null | undefined) {
  return phone?.replace(/\D/g, "") ?? "";
}

export function phoneNationalDigits(phone: string | null | undefined) {
  const digits = phoneDigits(phone);

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits;
}

export function normalizePhone(phone: string | null | undefined) {
  const trimmed = phone?.trim() ?? "";
  const digits = phoneDigits(trimmed);

  if (!digits) {
    return trimmed;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return trimmed.startsWith("+") ? trimmed : `+${digits}`;
}

export function phoneLookupVariants(phone: string | null | undefined) {
  const variants = new Set<string>();
  const trimmed = phone?.trim() ?? "";
  const normalized = normalizePhone(trimmed);
  const digits = phoneDigits(trimmed);

  if (trimmed) variants.add(trimmed);
  if (normalized) variants.add(normalized);

  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}
