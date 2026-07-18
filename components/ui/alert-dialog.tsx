"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

function AlertDialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function AlertDialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/35 opacity-0 backdrop-blur-[1px] transition-opacity data-[state=open]:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-5 shadow-2xl outline-none",
          className,
        )}
        role="alertdialog"
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-2 text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogCancel(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />;
}

function AlertDialogAction(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />;
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
};
