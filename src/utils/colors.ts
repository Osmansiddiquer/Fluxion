// Desmos-like categorical palette. Colours are picked in order and cycle.
export const PALETTE = [
  '#c74440', // red
  '#2d70b3', // blue
  '#388c46', // green
  '#6042a6', // purple
  '#fa7e19', // orange
  '#000000', // black
  '#cf2e6b', // pink
  '#0d9488', // teal
] as const;

/**
 * Pick the next colour not already used by `usedColors`, falling back to cycling
 * through the palette once every colour is taken.
 */
export function nextColor(usedColors: string[]): string {
  for (const c of PALETTE) {
    if (!usedColors.includes(c)) return c;
  }
  return PALETTE[usedColors.length % PALETTE.length];
}
