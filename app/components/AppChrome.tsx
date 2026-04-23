"use client";

import { usePathname } from "next/navigation";

import Footer from "./Footer";
import Header from "./Header";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPortalRoute = pathname.startsWith("/portal");

  return (
    <>
      {!isPortalRoute ? <Header /> : null}
      <main className={isPortalRoute ? "flex flex-col" : "flex flex-col pt-24"}>{children}</main>
      {!isPortalRoute ? <Footer /> : null}
    </>
  );
}
