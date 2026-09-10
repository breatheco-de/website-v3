/** Staff-facing min-length progress: red until met, green when ok. */
export function minLengthHint(
  value: string,
  min: number,
): { ok: boolean; text: string; className: string } {
  const count = value.trim().length;
  const ok = count >= min;
  return {
    ok,
    text: `${count} letter${count === 1 ? "" : "s"} so far, ${min} needed`,
    className: ok ? "text-xs text-status-online" : "text-xs text-destructive",
  };
}
