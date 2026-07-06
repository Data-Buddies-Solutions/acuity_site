import type { ChangeEventHandler, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type BaseFieldProps = {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
};

const fieldClassName =
  "w-full rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 text-sm text-[var(--portal-ink)] outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[var(--portal-accent)] focus:ring-2 focus:ring-[var(--portal-accent)]/12";

const labelClassName =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--portal-muted-soft)]";

export function PortalSelect({
  children,
  className,
  wrapperClassName,
  ...props
}: Readonly<
  SelectHTMLAttributes<HTMLSelectElement> & {
    wrapperClassName?: string;
  }
>) {
  return (
    <span className={cn("relative inline-flex w-full items-center", wrapperClassName)}>
      <select
        className={cn(
          "h-10 w-full appearance-none rounded-lg border border-[var(--portal-border)] bg-white pl-4 pr-10 text-sm font-medium text-[var(--portal-ink)] shadow-sm outline-none transition focus:border-[var(--portal-accent)] focus:ring-2 focus:ring-[var(--portal-accent)]/15 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--portal-muted-soft)]"
      />
    </span>
  );
}

export function PortalInputField({
  defaultValue,
  label,
  name,
  placeholder,
  required,
  type = "text",
}: Readonly<
  BaseFieldProps & {
    type?: "email" | "tel" | "text" | "url";
  }
>) {
  return (
    <label className="block space-y-2">
      <span className={labelClassName}>{label}</span>
      <input
        className={fieldClassName}
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

export function PortalTextareaField({
  defaultValue,
  label,
  name,
  placeholder,
  required,
  rows = 4,
}: Readonly<
  BaseFieldProps & {
    rows?: number;
  }
>) {
  return (
    <label className="block space-y-2">
      <span className={labelClassName}>{label}</span>
      <textarea
        className={`${fieldClassName} min-h-[112px] resize-y`}
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        rows={rows}
      />
    </label>
  );
}

export function PortalCodeTextareaField({
  defaultValue,
  label,
  minHeightClassName = "min-h-[620px]",
  name,
  onChange,
  required,
  value,
}: Readonly<
  BaseFieldProps & {
    minHeightClassName?: string;
    onChange?: ChangeEventHandler<HTMLTextAreaElement>;
    value?: string;
  }
>) {
  return (
    <label className="block space-y-2">
      <span className={labelClassName}>{label}</span>
      <textarea
        className={cn(fieldClassName, "font-mono leading-6", minHeightClassName)}
        defaultValue={defaultValue}
        name={name}
        onChange={onChange}
        required={required}
        value={value}
      />
    </label>
  );
}
