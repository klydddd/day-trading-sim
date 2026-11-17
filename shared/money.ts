/** Round to whole cents, half away from zero, immune to binary float error (1.005 -> 1.01). */
export function roundCents(n: number): number {
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1;
  const r = Math.round(Number(`${Math.abs(n)}e2`));
  const out = sign * Number(`${r}e-2`);
  return out === 0 ? 0 : out; // no -0
}

export function fmtUsd(n: number, decimals = 2): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const isNeg = n < 0 && Number(Math.abs(n).toFixed(decimals)) !== 0;
  return `${isNeg ? '-' : ''}$${abs}`;
}

export function fmtPct(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Signed money: "+$12.50" / "-$12.50" / "$0.00". Never rely on color alone. */
export function fmtSignedUsd(n: number, decimals = 2): string {
  const s = fmtUsd(n, decimals);
  return n > 0 && s !== fmtUsd(0, decimals) ? `+${s}` : s;
}
