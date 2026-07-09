import { notFound, redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";

const ADMIN_DOMAIN = "@acuityhealth.io";

let warnedDevAllowAll = false;
let warnedDomainFallback = false;

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
    if (!warnedDevAllowAll) {
      warnedDevAllowAll = true;
      console.warn(
        "[admin-auth] ADMIN_EMAILS is not configured; granting admin access to every authenticated user in development. Set ADMIN_EMAILS to restrict access.",
      );
    }

    return true;
  }

  const allowedByDomain = normalizedEmail.endsWith(ADMIN_DOMAIN);

  if (allowedByDomain && !warnedDomainFallback) {
    warnedDomainFallback = true;
    console.warn(
      `[admin-auth] ADMIN_EMAILS is not configured in production; granting admin access via the ${ADMIN_DOMAIN} domain fallback. Configure ADMIN_EMAILS to grant admin access explicitly.`,
    );
  }

  return allowedByDomain;
}

export function isExplicitAdminEmail(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return false;
  }

  const configuredEmails = getConfiguredAdminEmails();

  if (configuredEmails.length > 0) {
    return configuredEmails.includes(normalizedEmail);
  }

  return normalizedEmail.endsWith(ADMIN_DOMAIN);
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
