"use client";

import { useState } from "react";
import { exportFinanceAction, refreshRatesAction } from "@/app/(admin)/admin/(shell)/finance/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { inputClasses, selectFieldClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { CsvFormat } from "@/lib/finance/csv";

// Fetches TCMB's rates now, instead of waiting for the next scheduled run.
export function RefreshRatesButton({ label = "Fetch the rates now" }: { label?: string }) {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="sm"
          pending={pending === "refresh"}
          onClick={() => run("refresh", () => refreshRatesAction({}))}
        >
          {label}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The accountant's CSV for a span of days. Asks to confirm it's you first.
export function ExportForm({ from, to }: { from: string; to: string }) {
  const { run, pending, message } = useActionRunner();
  const [value, setValue] = useState<{ from: string; to: string; format: CsvFormat }>({
    from,
    to,
    format: "excel-tr",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("export", () => exportFinanceAction(value));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok && result.data.rows) download(result.data.filename, result.data.csv);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormRow id="export-from" label="From" error={errors.from}>
          <input
            {...controlProps("export-from", errors.from)}
            type="date"
            className={inputClasses}
            value={value.from}
            onChange={(event) => setValue({ ...value, from: event.target.value })}
          />
        </FormRow>
        <FormRow id="export-to" label="To" error={errors.to}>
          <input
            {...controlProps("export-to", errors.to)}
            type="date"
            className={inputClasses}
            value={value.to}
            onChange={(event) => setValue({ ...value, to: event.target.value })}
          />
        </FormRow>
        <FormRow id="export-format" label="Opens in" error={errors.format}>
          <select
            {...controlProps("export-format", errors.format)}
            className={selectFieldClasses}
            value={value.format}
            onChange={(event) => setValue({ ...value, format: event.target.value as CsvFormat })}
          >
            <option value="excel-tr">Excel in Turkish (semicolons, 1.234,56)</option>
            <option value="standard">Anything else (commas, 1234.56)</option>
          </select>
        </FormRow>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" pending={pending === "export"}>
          Download the CSV
        </Button>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    </form>
  );
}
