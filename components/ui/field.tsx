import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
};

// Classes are joined, not merged, so each control spells out its own size.
const control = cn(
  "rounded-md border border-line-strong bg-canvas text-ink placeholder:text-muted/60",
  "focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/25",
  "aria-invalid:border-danger/70 disabled:opacity-60",
);

export const inputClasses = cn(control, "h-10 w-full px-3 text-sm");

export const textareaClasses = cn(control, "min-h-24 w-full px-3 py-2 text-sm leading-6");

// A compact select that sits next to a button.
export const selectClasses = cn(control, "h-8 max-w-full px-2 text-[13px]");

// A select that fills a form column, as tall as a text input.
export const selectFieldClasses = cn(control, "h-10 w-full px-2.5 text-sm");

// A compact text input for inline rows (quick add, checklists); the base one sizes to its content.
export const compactInputBase = cn(control, "h-8 px-2.5 text-[13px]");
export const compactInputClasses = cn(compactInputBase, "w-full");

export function Field({ label, name, error, hint, className, id, ...rest }: FieldProps) {
  const inputId = id ?? `field-${name}`;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={inputId} className="text-[13px] font-medium text-ink/90">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        className={inputClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
