import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

// A labelled form control with its hint and error. The control itself takes controlProps(), which links
// it to both for screen readers.
export function FormRow({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink/90">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function controlProps(id: string, error?: string, hasHint = false) {
  const describedBy = [error ? `${id}-error` : null, hasHint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return {
    id,
    name: id.replace(/^[a-z]+-/, ""),
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

// A form's text fields as a plain object (checkboxes are read separately, as booleans).
export function readForm(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}
