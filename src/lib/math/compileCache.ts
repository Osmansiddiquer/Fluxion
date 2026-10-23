import type { EvalFunction, MathNode } from 'mathjs';
import { fastCompile } from './fastCompile';

// Compiling is non-trivial; cache by node identity. Parsed nodes are stable
// (parseEntry is cached), so these entries persist across viewport changes.
// The evaluator is lib/math/fastCompile (native arithmetic + hoisted invariant
// sub-expressions, same results as mathjs' own compile).
const cache = new WeakMap<MathNode, EvalFunction>();

/**
 * Compiled evaluator for a node. `varying` lists extra names that change on
 * every call (ODE state, function parameters) so they're never hoisted; it only
 * affects speed, never results. The first compile of a node fixes it.
 */
export function compileNode(node: MathNode, varying?: Iterable<string>): EvalFunction {
  let compiled = cache.get(node);
  if (!compiled) {
    compiled = fastCompile(node, varying);
    cache.set(node, compiled);
  }
  return compiled;
}
