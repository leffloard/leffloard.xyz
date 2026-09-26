// The flag in front of a flagged task's title; screen readers hear "Flagged".
export function FlagMark() {
  return (
    <>
      <span aria-hidden className="mr-1 text-warning">
        ⚑
      </span>
      <span className="sr-only">Flagged: </span>
    </>
  );
}
