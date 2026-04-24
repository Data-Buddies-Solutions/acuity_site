type BaseFieldProps = {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
};

const fieldClassName =
  "w-full rounded-[1.15rem] border border-black/8 bg-[#fbfdfc] px-4 py-3 text-sm text-[#10272c] outline-none transition placeholder:text-[#90a0a2] focus:border-[#0d7377] focus:ring-2 focus:ring-[#0d7377]/12";

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
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6a7b7e]">
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
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6a7b7e]">
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
