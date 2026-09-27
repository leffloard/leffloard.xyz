// IBANs: normalised, checked (length per country and the ISO 13616 mod-97 checksum) and grouped for reading,
// so a mistyped account number never reaches an invoice.

const LENGTHS: Record<string, number> = {
  TR: 26,
  DE: 22,
  GB: 22,
  NL: 18,
  FR: 27,
  ES: 24,
  IT: 27,
  BE: 16,
  AT: 20,
  CH: 21,
  LT: 20,
  PL: 28,
  IE: 22,
};

export function normalizeIban(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const expected = LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  // Move the first four characters to the end, letters become 10-35, and the number mod 97 must be 1.
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

// "TR33 0006 1005 1978 6457 8413 26".
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

export function isValidBic(text: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(text);
}
