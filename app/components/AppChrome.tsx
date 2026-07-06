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
        id={isWorkspaceRoute ? undefined : "main-content"}
        tabIndex={isWorkspaceRoute ? undefined : -1}
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

  return isWorkspaceRoute ? (
    chrome
  ) : (
    <div className="marketing-site">
      <a
        className="fixed left-4 top-4 z-[100] -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href="#main-content"
      >
        Skip to content
      </a>
      {chrome}
    </div>
  );
}
