"use client";

import { FormRow, controlProps } from "@/components/admin/form-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { inputClasses, selectFieldClasses, textareaClasses } from "@/components/ui/field";
import type { FieldSpec } from "@/lib/content/fields";

// Draws a content form from its field list (lib/content/fields.ts). Values are the editor's input shape;
// errors are keyed by path ("packages.0.name"), as the server returns them.

export type WorkOption = { slug: string; title: string };
type Value = Record<string, unknown>;

type Props = {
  fields: FieldSpec[];
  value: Value;
  onChange: (next: Value) => void;
  errors: Record<string, string>;
  workOptions: WorkOption[];
  path?: string;
};

const join = (path: string, name: string | number) => (path ? `${path}.${name}` : String(name));
const idFor = (path: string) => `content-${path.replace(/\./g, "-")}`;

export function ContentFields({ fields, value, onChange, errors, workOptions, path = "" }: Props) {
  return (
    <div className="grid gap-5">
      {fields.map((field) => (
        <FieldControl
          key={field.name}
          field={field}
          value={value[field.name]}
          onChange={(inner) => onChange({ ...value, [field.name]: inner })}
          errors={errors}
          workOptions={workOptions}
          path={join(path, field.name)}
        />
      ))}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  errors,
  workOptions,
  path,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  errors: Record<string, string>;
  workOptions: WorkOption[];
  path: string;
}) {
  const id = idFor(path);
  const error = errors[path];
  const hint = field.hint;
  const control = controlProps(id, error, Boolean(hint));

  switch (field.type) {
    case "text":
    case "date":
      return (
        <FormRow id={id} label={field.label} error={error} hint={hint}>
          <input
            {...control}
            type={field.type === "date" ? "date" : "text"}
            className={inputClasses}
            placeholder={field.type === "text" ? field.placeholder : undefined}
            value={String(value ?? "")}
            onChange={(event) => onChange(event.target.value)}
          />
        </FormRow>
      );
    case "textarea":
    case "markdown":
      return (
        <FormRow id={id} label={field.label} error={error} hint={hint}>
          <textarea
            {...control}
            rows={field.type === "markdown" ? 22 : (field.rows ?? 3)}
            className={cn(textareaClasses, field.type === "markdown" && "font-mono text-[13px] leading-6")}
            spellCheck={field.type === "markdown" ? true : undefined}
            value={String(value ?? "")}
            onChange={(event) => onChange(event.target.value)}
          />
        </FormRow>
      );
    case "number":
      return (
        <FormRow id={id} label={field.label} error={error} hint={hint}>
          <input
            {...control}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className={inputClasses}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          />
        </FormRow>
      );
    case "boolean":
      return (
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              {...control}
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            {field.label}
          </label>
          {error ? (
            <p id={`${id}-error`} className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      );
    case "select":
      return (
        <FormRow id={id} label={field.label} error={error} hint={hint}>
          <select
            {...control}
            className={selectFieldClasses}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(event) =>
              onChange(field.nullable && event.target.value === "" ? null : event.target.value)
            }
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormRow>
      );
    case "lines":
      return (
        <FormRow id={id} label={field.label} error={error ?? firstNested(errors, path)} hint={hint}>
          <textarea
            {...control}
            rows={field.rows ?? 3}
            className={textareaClasses}
            value={Array.isArray(value) ? value.join("\n") : ""}
            onChange={(event) => onChange(event.target.value.split("\n"))}
          />
        </FormRow>
      );
    case "workRef":
      return (
        <FormRow id={id} label={field.label} error={error} hint={hint}>
          <select
            {...control}
            className={selectFieldClasses}
            value={String(value ?? "")}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">None</option>
            {workOptions.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.title}
              </option>
            ))}
          </select>
        </FormRow>
      );
    case "workRefs": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      const missing = chosen.filter((slug) => !workOptions.some((option) => option.slug === slug));
      const toggle = (slug: string, on: boolean) =>
        onChange(on ? [...chosen, slug] : chosen.filter((item) => item !== slug));
      return (
        <fieldset className="grid gap-2" aria-describedby={error ? `${id}-error` : undefined}>
          <legend className="text-[13px] font-medium text-ink/90">{field.label}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {[...workOptions, ...missing.map((slug) => ({ slug, title: `${slug} (not found)` }))].map(
              (option) => (
                <label key={option.slug} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.includes(option.slug)}
                    onChange={(event) => toggle(option.slug, event.target.checked)}
                    className="accent-[var(--color-accent)]"
                  />
                  {option.title}
                </label>
              ),
            )}
          </div>
          {(error ?? firstNested(errors, path)) ? (
            <p id={`${id}-error`} className="text-xs text-danger">
              {error ?? firstNested(errors, path)}
            </p>
          ) : null}
        </fieldset>
      );
    }
    case "group":
      return (
        <fieldset className="grid gap-4 rounded-lg border border-line p-4">
          <legend className="px-1 text-[13px] font-medium text-ink/90">{field.label}</legend>
          <ContentFields
            fields={field.fields}
            value={(value as Value) ?? {}}
            onChange={onChange}
            errors={errors}
            workOptions={workOptions}
            path={path}
          />
        </fieldset>
      );
    case "list": {
      const items = Array.isArray(value) ? (value as Value[]) : [];
      const replace = (index: number, next: Value | null) =>
        onChange(
          next === null
            ? items.filter((_, at) => at !== index)
            : items.map((item, at) => (at === index ? next : item)),
        );
      const move = (index: number, by: -1 | 1) => {
        const next = [...items];
        const [item] = next.splice(index, 1);
        next.splice(index + by, 0, item!);
        onChange(next);
      };
      return (
        <fieldset className="grid gap-3" aria-describedby={error ? `${id}-error` : undefined}>
          <legend className="text-[13px] font-medium text-ink/90">{field.label}</legend>
          {error ? (
            <p id={`${id}-error`} className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {items.map((item, index) => (
            <div key={index} className="grid gap-4 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">
                  {field.itemLabel} {index + 1}
                </p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move ${field.itemLabel.toLowerCase()} ${index + 1} up`}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === items.length - 1}
                    aria-label={`Move ${field.itemLabel.toLowerCase()} ${index + 1} down`}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${field.itemLabel.toLowerCase()} ${index + 1}`}
                    onClick={() => replace(index, null)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <ContentFields
                fields={field.item}
                value={item}
                onChange={(next) => replace(index, next)}
                errors={errors}
                workOptions={workOptions}
                path={join(path, index)}
              />
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              onClick={() => onChange([...items, structuredClone(field.empty)])}
            >
              Add {field.itemLabel.toLowerCase()}
            </Button>
          </div>
        </fieldset>
      );
    }
  }
}

// A problem with one line of a list ("stack.2") shown on the list's own field.
function firstNested(errors: Record<string, string>, path: string): string | undefined {
  const key = Object.keys(errors).find((name) => name.startsWith(`${path}.`));
  return key ? errors[key] : undefined;
}
