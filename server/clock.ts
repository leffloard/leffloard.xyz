import "server-only";

type Clock = () => Date;

let current: Clock = () => new Date();

export function now(): Date {
  return current();
}

export function setClock(clock: Clock): void {
  current = clock;
}

export function resetClock(): void {
  current = () => new Date();
}
