import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        compact: "h-8 px-2.5",
        default: "h-10 px-4",
        icon: "size-10",
        lg: "h-12 px-6 text-base",
        sm: "h-9 px-3 text-[0.85rem]",
      },
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/85",
        primary: "bg-accent text-white hover:bg-accent-hover",
        destructive:
          "bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-500/20",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-accent underline-offset-4 hover:underline",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground",
        secondary:
          "border-border bg-background text-foreground shadow-sm hover:bg-muted hover:text-foreground",
      },
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { asChild = false, className, size = "default", type = "button", variant, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ className, size, variant }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
