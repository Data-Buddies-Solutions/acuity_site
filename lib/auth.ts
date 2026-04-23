import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { headers } from "next/headers";

import { SITE_CONFIG } from "@/lib/config";
import { prisma } from "@/lib/prisma";

const authBaseUrl =
  process.env.BETTER_AUTH_URL ||
  process.env.AUTH_URL ||
  (process.env.NODE_ENV === "production" ? SITE_CONFIG.baseUrl : "http://localhost:3000");

// Keep builds from failing without env vars, but replace this before deploying.
const authSecret =
  process.env.BETTER_AUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "acuity-build-placeholder-secret-set-better-auth-secret-before-deploy";

const trustedOrigins = Array.from(
  new Set([new URL(authBaseUrl).origin, new URL(SITE_CONFIG.baseUrl).origin])
);

export const auth = betterAuth({
  appName: "Acuity Practice Portal",
  baseURL: authBaseUrl,
  secret: authSecret,
  trustedOrigins,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.PORTAL_ALLOW_SIGNUP !== "true",
  },
  advanced: {
    cookiePrefix: "acuity",
  },
});

export async function getAuthSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}
