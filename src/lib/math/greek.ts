// Greek-letter support. Users type words (`alpha`); the input shows glyphs (`α`);
// mathjs sees the ASCII word again; KaTeX renders the proper symbol (`\alpha`).
//
// Note: `pi`, `tau`, `phi`, `e` are mathjs *constants*, so their glyphs resolve to
// those constant values rather than free variables.

interface GreekEntry {
  word: string;
  glyph: string;
  tex: string;
}

const ENTRIES: GreekEntry[] = [
  { word: 'alpha', glyph: 'α', tex: '\\alpha' },
  { word: 'beta', glyph: 'β', tex: '\\beta' },
  { word: 'gamma', glyph: 'γ', tex: '\\gamma' },
  { word: 'delta', glyph: 'δ', tex: '\\delta' },
  { word: 'epsilon', glyph: 'ε', tex: '\\varepsilon' },
  { word: 'zeta', glyph: 'ζ', tex: '\\zeta' },
  { word: 'eta', glyph: 'η', tex: '\\eta' },
  { word: 'theta', glyph: 'θ', tex: '\\theta' },
  { word: 'iota', glyph: 'ι', tex: '\\iota' },
  { word: 'kappa', glyph: 'κ', tex: '\\kappa' },
  { word: 'lambda', glyph: 'λ', tex: '\\lambda' },
  { word: 'mu', glyph: 'μ', tex: '\\mu' },
  { word: 'nu', glyph: 'ν', tex: '\\nu' },
  { word: 'xi', glyph: 'ξ', tex: '\\xi' },
  { word: 'omicron', glyph: 'ο', tex: 'o' },
  { word: 'pi', glyph: 'π', tex: '\\pi' },
  { word: 'rho', glyph: 'ρ', tex: '\\rho' },
  { word: 'sigma', glyph: 'σ', tex: '\\sigma' },
  { word: 'tau', glyph: 'τ', tex: '\\tau' },
  { word: 'upsilon', glyph: 'υ', tex: '\\upsilon' },
  { word: 'phi', glyph: 'φ', tex: '\\phi' },
  { word: 'chi', glyph: 'χ', tex: '\\chi' },
  { word: 'psi', glyph: 'ψ', tex: '\\psi' },
  { word: 'omega', glyph: 'ω', tex: '\\omega' },
  { word: 'Gamma', glyph: 'Γ', tex: '\\Gamma' },
  { word: 'Delta', glyph: 'Δ', tex: '\\Delta' },
  { word: 'Theta', glyph: 'Θ', tex: '\\Theta' },
  { word: 'Lambda', glyph: 'Λ', tex: '\\Lambda' },
  { word: 'Xi', glyph: 'Ξ', tex: '\\Xi' },
  { word: 'Pi', glyph: 'Π', tex: '\\Pi' },
  { word: 'Sigma', glyph: 'Σ', tex: '\\Sigma' },
  { word: 'Phi', glyph: 'Φ', tex: '\\Phi' },
  { word: 'Psi', glyph: 'Ψ', tex: '\\Psi' },
  { word: 'Omega', glyph: 'Ω', tex: '\\Omega' },
];

export const GREEK_WORDS = ENTRIES.map((e) => e.word);

const GLYPH_TO_WORD = new Map(ENTRIES.map((e) => [e.glyph, e.word]));
const WORD_TO_GLYPH = new Map(ENTRIES.map((e) => [e.word, e.glyph]));
const WORD_TO_TEX = new Map(ENTRIES.map((e) => [e.word, e.tex]));

// Longest-first so `theta` is matched before `eta`, `epsilon` before `psi`, etc.
const WORD_RE = new RegExp(
  `\\b(${ENTRIES.map((e) => e.word).sort((a, b) => b.length - a.length).join('|')})\\b`,
  'g',
);
const GLYPH_RE = new RegExp(`[${ENTRIES.map((e) => e.glyph).join('')}]`, 'g');

/** Replace Greek glyphs with their ASCII word (for mathjs parsing). */
export function greekGlyphToWord(s: string): string {
  return s.replace(GLYPH_RE, (g) => GLYPH_TO_WORD.get(g) ?? g);
}

/** Replace Greek words with their glyph (for nicer in-field editing). */
export function greekWordToGlyph(s: string): string {
  return s.replace(WORD_RE, (w) => WORD_TO_GLYPH.get(w) ?? w);
}

/** Replace Greek words with their LaTeX command (for KaTeX display). */
export function greekWordToTex(s: string): string {
  return s.replace(WORD_RE, (w) => WORD_TO_TEX.get(w) ?? w);
}
