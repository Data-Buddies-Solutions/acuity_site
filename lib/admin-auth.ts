import { notFound, redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";

function getConfiguredAdminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ACUITY_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return false;
  }

  const configuredEmails = getConfiguredAdminEmails();

  if (configuredEmails.length > 0) {
    return configuredEmails.includes(normalizedEmail);
  }

  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return normalizedEmail.endsWith("@acuityhealth.io");
}

export async function requireAdminSession() {
  const session = await getAuthSession();

  if (!session) {
    redirect("/portal?next=/admin/practices");
  }

  if (!isAdminEmail(session.user.email)) {
    notFound();
  }

  return session;
}
