"use client";

import { usePathname } from "next/navigation";

import Footer from "./Footer";
import Header from "./Header";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWorkspaceRoute =
    pathname.startsWith("/portal") || pathname.startsWith("/admin");
  const isHomeRoute = pathname === "/";

  const chrome = (
    <>
      {!isWorkspaceRoute ? <Header /> : null}
      <main
        className={
          isWorkspaceRoute
            ? "flex flex-col"
            : isHomeRoute
              ? "flex flex-col bg-canvas pt-24"
              : "flex flex-col pt-24"
        }
      >
        {children}
      </main>
      {!isWorkspaceRoute ? <Footer /> : null}
    </>
  );

  return isWorkspaceRoute ? chrome : <div className="marketing-site">{chrome}</div>;
}
