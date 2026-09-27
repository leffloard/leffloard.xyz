// RFC 4648 base32 without padding, the encoding authenticator apps expect for TOTP secrets.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

// Accepts lower case, spaces and padding, as people copy secrets in all shapes. Throws on other characters.
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error("Invalid base32 character.");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}
