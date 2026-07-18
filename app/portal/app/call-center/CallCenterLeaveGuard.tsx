"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function CallCenterLeaveGuard({ active }: { active: boolean }) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const initiatingLinkRef = useRef<HTMLAnchorElement | null>(null);
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button > 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target as Element | null;
      const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (
        !link ||
        link.hasAttribute("download") ||
        Boolean(link.getAttribute("target"))
      ) {
        return;
      }

      const destination = new URL(link.href, window.location.href);
      const staysInCallCenter =
        destination.origin === window.location.origin &&
        destination.pathname === "/portal/app/call-center";
      if (staysInCallCenter) return;

      event.preventDefault();
      event.stopPropagation();
      initiatingLinkRef.current = link;
      leavingRef.current = false;
      setPendingHref(destination.href);
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active]);

  useEffect(() => {
    if (active) return;
    leavingRef.current = false;
    initiatingLinkRef.current = null;
    // Deactivation ends the guarded transition and must discard its destination.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingHref(null);
  }, [active]);

  const leave = () => {
    if (!pendingHref) return;
    const destination = new URL(pendingHref);
    leavingRef.current = true;
    setPendingHref(null);
    if (destination.origin === window.location.origin) {
      router.push(`${destination.pathname}${destination.search}${destination.hash}`);
    } else {
      window.location.assign(destination.href);
    }
  };

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) return;
        setPendingHref(null);
        if (!leavingRef.current) initiatingLinkRef.current?.focus();
      }}
      open={active && Boolean(pendingHref)}
    >
      <AlertDialogContent
        className="portal-platform"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!leavingRef.current) initiatingLinkRef.current?.focus();
        }}
      >
        <AlertDialogTitle>Leave the Call Center?</AlertDialogTitle>
        <AlertDialogDescription>
          This call still needs your attention. Stay here to keep the live controls
          available, or leave intentionally.
        </AlertDialogDescription>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel asChild>
            <Button variant="secondary">Stay in Call Center</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button onClick={leave} variant="destructive">
              Leave Call Center
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
