import "server-only";
import { randomBytes } from "node:crypto";

// The address of a quote or an invoice for its client (/q/<id>, /i/<id>): 128 random bits written as 22
// base62 characters, so it can't be guessed or counted through.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LENGTH = 22; // 62^22 > 2^128

export const PUBLIC_ID_PATTERN = /^[0-9A-Za-z]{22}$/;

export function newPublicId(): string {
  let value = BigInt(`0x${randomBytes(16).toString("hex")}`);
  let text = "";
  for (let index = 0; index < LENGTH; index++) {
    text = ALPHABET[Number(value % 62n)] + text;
    value /= 62n;
  }
  return text;
}
