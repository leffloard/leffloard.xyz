// Ordering keys for lists the owner rearranges (board columns, task lists). Each item stores a string
// `rank`; sorting by it gives the order, and moving an item writes only that item's new rank, picked
// between its new neighbours. This is David Greenspan's fractional indexing (as published by Rocicorp
// under CC0): a variable-length "integer" head keeps keys short when items are added at either end, and
// a fractional tail allows a key between any two keys. Keys use base 62 in ASCII order, so a plain
// string comparison, in JavaScript or MongoDB, sorts them.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0]!;
const LAST = DIGITS[DIGITS.length - 1]!;
// The smallest integer head: no key may be below it.
const SMALLEST_INTEGER = "A" + ZERO.repeat(26);

export class RankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankError";
  }
}

// A key strictly between two fractional tails; `a` may be "", `b` null means "no upper bound".
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RankError(`${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b !== null && b.slice(-1) === ZERO)) throw new RankError("trailing zero");
  if (b !== null) {
    // Skip the common prefix, reading a missing digit of `a` as zero.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]!;
  // The first digits are neighbours.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

// "a" to "z" start positive integers with 1 to 26 digits; "Z" to "A" negative ones.
function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new RankError(`invalid rank head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0] ?? "");
  if (length > key.length) throw new RankError(`invalid rank: ${key}`);
  return key.slice(0, length);
}

function validate(key: string): void {
  if (key === SMALLEST_INTEGER) throw new RankError(`invalid rank: ${key}`);
  const fraction = key.slice(integerPart(key).length);
  if (fraction.slice(-1) === ZERO) throw new RankError(`invalid rank: ${key}`);
}

export function isRank(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 200) return false;
  if ([...key].some((char) => !DIGITS.includes(char))) return false;
  try {
    validate(key);
    return true;
  } catch {
    return false;
  }
}

function incrementInteger(value: string): string | null {
  const [head, ...digits] = value.split("") as [string, ...string[]];
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]!) + 1;
    if (next === DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = DIGITS[next]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join("");
}

function decrementInteger(value: string): string | null {
  const [head, ...digits] = value.split("") as [string, ...string[]];
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]!) - 1;
    if (next === -1) {
      digits[i] = LAST;
    } else {
      digits[i] = DIGITS[next]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");
  if (head === "a") return "Z" + LAST;
  if (head === "A") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < "Z") digits.push(LAST);
  else digits.pop();
  return nextHead + digits.join("");
}

/**
 * A rank that sorts after `a` and before `b`. Null `a` means "at the start", null `b` "at the end";
 * both null gives the first rank of an empty list.
 */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new RankError(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return "a" + ZERO;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint("", fracB);
    if (intB < b) return intB;
    const lower = decrementInteger(intB);
    if (lower === null) throw new RankError("cannot rank before this item");
    return lower;
  }

  if (b === null) {
    const intA = integerPart(a);
    const higher = incrementInteger(intA);
    return higher === null ? intA + midpoint(a.slice(intA.length), null) : higher;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  const intB = integerPart(b);
  if (intA === intB) return intA + midpoint(fracA, b.slice(intB.length));
  const higher = incrementInteger(intA);
  if (higher === null) throw new RankError("cannot rank after this item");
  if (higher < b) return higher;
  return intA + midpoint(fracA, null);
}

// `count` ranks in order, for renumbering a whole list.
export function ranksFor(count: number): string[] {
  const ranks: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < count; i++) {
    previous = rankBetween(previous, null);
    ranks.push(previous);
  }
  return ranks;
}
