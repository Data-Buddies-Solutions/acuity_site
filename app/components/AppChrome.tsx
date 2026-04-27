"use client";

import { usePathname } from "next/navigation";

import Footer from "./Footer";
import Header from "./Header";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWorkspaceRoute = pathname.startsWith("/portal") || pathname.startsWith("/admin");

  return (
    <>
      {!isWorkspaceRoute ? <Header /> : null}
      <main className={isWorkspaceRoute ? "flex flex-col" : "flex flex-col pt-24"}>{children}</main>
      {!isWorkspaceRoute ? <Footer /> : null}
    </>
  );
}
