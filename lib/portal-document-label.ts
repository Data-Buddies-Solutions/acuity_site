export function getPortalLocationDocumentLabel({
  locationName,
  slug,
  title,
  titlePrefix,
}: {
  locationName: string | null;
  slug: string;
  title: string;
  titlePrefix: string;
}) {
  if (locationName) {
    return locationName;
  }
  if (slug.includes("crystal")) {
    return "Crystal River";
  }
  if (slug.includes("spring")) {
    return "Spring Hill";
  }

  const prefix = `${titlePrefix}:`;
  return title.toLowerCase().startsWith(prefix.toLowerCase())
    ? title.slice(prefix.length).trim()
    : title;
}
