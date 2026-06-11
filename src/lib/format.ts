// Central numeric display formatting. Significant figures are user-configurable
// (default 3) and applied to coordinate readouts, tooltips, point coordinates,
// projection panels, and variable values. A module-level cache lets pure draw /
// format code read the setting without threading it through every call; the store
// keeps it in sync via setSigFigs().

let SIG = 3;

export function setSigFigs(n: number): void {
  SIG = Math.max(1, Math.min(12, Math.round(n)));
}

export function getSigFigs(): number {
  return SIG;
}

/** Format a number to the current significant-figure setting, trimmed. */
export function fmtSig(n: number, sig = SIG): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1e-12) return '0';
  return Number(n.toPrecision(sig)).toString();
}
