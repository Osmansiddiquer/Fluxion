import { parse as mjParse } from 'mathjs';

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/** Format a radian value as a tidy multiple of π: 0, π, 2π, π/2, 3π/4, … */
export function formatPi(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) < 1e-9) return '0';
  const k = v / Math.PI;
  const rk = Math.round(k * 1e6) / 1e6;
  // Whole multiples of π.
  if (Math.abs(rk - Math.round(rk)) < 1e-6) {
    const n = Math.round(rk);
    return n === 1 ? 'π' : n === -1 ? '-π' : `${n}π`;
  }
  // Simple fractions of π.
  for (const d of [2, 3, 4, 6, 8, 12]) {
    const num = rk * d;
    if (Math.abs(num - Math.round(num)) < 1e-4) {
      let n = Math.round(num);
      let dd = d;
      const g = gcd(n, dd);
      n /= g;
      dd /= g;
      if (dd === 1) return n === 1 ? 'π' : n === -1 ? '-π' : `${n}π`;
      const sign = n < 0 ? '-' : '';
      const top = Math.abs(n) === 1 ? 'π' : `${Math.abs(n)}π`;
      return `${sign}${top}/${dd}`;
    }
  }
  return `${Number(k.toPrecision(4))}π`;
}

/** Parse a π-aware expression (e.g. "6pi", "π/2", "2*pi", "4") to radians, or null. */
export function parsePi(text: string): number | null {
  const t = text.trim().replace(/π/g, 'pi');
  if (t === '') return null;
  try {
    const v = mjParse(t).evaluate({});
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
