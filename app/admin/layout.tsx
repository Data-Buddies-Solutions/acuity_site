import type { Metadata } from "next";

import { AdminShell } from "@/app/admin/AdminShell";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Admin Portal",
  description: "Internal Acuity Health practice operations portal.",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireAdminSession();

  return <AdminShell userEmail={session.user.email}>{children}</AdminShell>;
}
