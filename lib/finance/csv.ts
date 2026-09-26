import { formatRate } from "@/lib/finance/fx";

// CSV for the accountant. "standard" is what most tools import (commas, a decimal point); "excel-tr" is what
// Excel opens as columns on a Turkish Windows (semicolons, a decimal comma). Both start with a byte order
// mark so Excel reads the text as UTF-8. Text that a spreadsheet would run as a formula is defused.

export const CSV_FORMATS = ["standard", "excel-tr"] as const;
export type CsvFormat = (typeof CSV_FORMATS)[number];

export type CsvCell = string | { minor: number } | { rate: number } | null;

const FORMULA_START = /^[=+\-@\t\r]/;

function text(value: string, separator: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function amount(minor: number, decimal: string): string {
  const sign = minor < 0 ? "-" : "";
  const magnitude = Math.abs(minor);
  return `${sign}${Math.floor(magnitude / 100)}${decimal}${String(magnitude % 100).padStart(2, "0")}`;
}

export function toCsv(header: readonly string[], rows: readonly CsvCell[][], format: CsvFormat): string {
  const separator = format === "excel-tr" ? ";" : ",";
  const decimal = format === "excel-tr" ? "," : ".";
  const cell = (value: CsvCell): string => {
    if (value === null) return "";
    if (typeof value === "string") return text(value, separator);
    if ("minor" in value) return amount(value.minor, decimal);
    return formatRate(value.rate, decimal);
  };
  const lines = [header.map((name) => text(name, separator)), ...rows.map((row) => row.map(cell))];
  return `﻿${lines.map((line) => line.join(separator)).join("\r\n")}\r\n`;
}
