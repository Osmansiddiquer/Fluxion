// Friendly math vocabulary: synonyms mapped onto mathjs names, the set of known
// functions (for validation + autocomplete), and constants.

/** Friendly function names → mathjs function names (applied when followed by `(`). */
export const FUNCTION_SYNONYMS: Record<string, string> = {
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  arcsec: 'asec',
  arccsc: 'acsc',
  arccot: 'acot',
  arccosec: 'acsc',
  cosec: 'csc',
  arccosech: 'acsch',
  cosech: 'csch',
  ln: 'log', // natural log (mathjs `log` is natural)
  lg: 'log10',
  sgn: 'sign',
};

/** Unicode → ASCII conveniences (applied globally). */
export const UNICODE_MAP: [RegExp, string][] = [
  [/π/g, 'pi'],
  [/τ/g, 'tau'],
  [/[×⋅·∙]/g, '*'],
  [/÷/g, '/'],
  [/−/g, '-'], // U+2212 minus
  [/√/g, 'sqrt'],
  [/²/g, '^2'],
  [/³/g, '^3'],
  [/∞/g, 'Infinity'],
];

/** Base trig names whose `^-1` means the inverse (arc) function. */
export const INVERSE_BASE = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
]);

/** All function names mathjs understands that we expose / validate against. */
export const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'asin', 'acos', 'atan', 'asec', 'acsc', 'acot', 'atan2',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'asinh', 'acosh', 'atanh', 'asech', 'acsch', 'acoth',
  'sqrt', 'cbrt', 'nthRoot', 'exp', 'log', 'log10', 'log2',
  'abs', 'sign', 'floor', 'ceil', 'round', 'fix',
  'min', 'max', 'mod', 'pow', 'gamma', 'factorial', 'gcd', 'lcm',
  'hypot', 'sinc',
]);

/** Built-in constants. */
export const CONSTANTS = ['pi', 'e', 'tau', 'phi', 'Infinity'];

/** Friendly names offered in autocomplete (preferring the readable spelling). */
export const FUNCTION_SUGGESTIONS = [
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'exp', 'ln', 'log', 'log10',
  'abs', 'sign', 'floor', 'ceil', 'round', 'min', 'max', 'mod', 'gamma',
];
