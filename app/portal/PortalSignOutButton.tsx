"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function PortalSignOutButton({
  className,
  onRequest,
}: {
  className?: string;
  onRequest?: (signOut: () => void) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
      await authClient.signOut();
      router.replace("/portal");
      router.refresh();
    });

  return (
    <Button
      size="sm"
      type="button"
      variant="secondary"
      className={className}
      disabled={isPending}
      onClick={() => (onRequest ? onRequest(signOut) : signOut())}
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {isPending ? "Signing out" : "Sign out"}
    </Button>
  );
}
