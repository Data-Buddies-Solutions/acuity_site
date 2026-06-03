export function normalizeSmsPhone(phone: string | null | undefined) {
  const digits = (phone || "").replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (phone?.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return "";
}

export function smsPhoneLookupVariants(phone: string | null | undefined) {
  const normalized = normalizeSmsPhone(phone);
  const digits = normalized.replace(/\D/g, "");
  const variants = new Set<string>();

  if (!digits) {
    return [];
  }

  variants.add(normalized);
  variants.add(digits);

  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
  }

  if (digits.length === 10) {
    variants.add(`1${digits}`);
    variants.add(`+1${digits}`);
  }

  return [...variants].filter(Boolean);
}

export function formatSmsPhone(phone: string | null | undefined) {
  const normalized = normalizeSmsPhone(phone);
  const digits = normalized.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return phone || "";
}
