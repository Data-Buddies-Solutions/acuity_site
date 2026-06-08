type BaseFieldProps = {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
};

const fieldClassName =
  "w-full rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 text-sm text-[var(--portal-ink)] outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[var(--portal-accent)] focus:ring-2 focus:ring-[var(--portal-accent)]/12";

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
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--portal-muted-soft)]">
        {label}
      </span>
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
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--portal-muted-soft)]">
        {label}
      </span>
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
