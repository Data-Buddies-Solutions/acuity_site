export type PracticeBranding = {
  accentColor: string | null;
  logoAlt: string | null;
  logoUrl: string | null;
  markUrl: string | null;
  primaryColor: string | null;
};

export const emptyPracticeBranding: PracticeBranding = {
  accentColor: null,
  logoAlt: null,
  logoUrl: null,
  markUrl: null,
  primaryColor: null,
};

function textValue(value: string | null | undefined) {
  return value?.trim() || null;
}

export function getPracticeBranding(practice: {
  brandAccentColor?: string | null;
  brandLogoAlt?: string | null;
  brandLogoUrl?: string | null;
  brandMarkUrl?: string | null;
  brandPrimaryColor?: string | null;
  name?: string | null;
}): PracticeBranding {
  const logoUrl = textValue(practice.brandLogoUrl);
  const practiceName = textValue(practice.name);

  return {
    accentColor: textValue(practice.brandAccentColor),
    logoAlt:
      textValue(practice.brandLogoAlt) ||
      (practiceName ? `${practiceName} logo` : "Practice logo"),
    logoUrl,
    markUrl: textValue(practice.brandMarkUrl) || logoUrl,
    primaryColor: textValue(practice.brandPrimaryColor),
  };
}

export function hasPracticeLogo(branding: PracticeBranding | null | undefined) {
  return Boolean(branding?.logoUrl);
}
