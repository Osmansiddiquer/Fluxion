import type { EvalFunction, MathNode } from 'mathjs';

// Compiling a mathjs node is non-trivial; cache by node identity. Parsed nodes are
// stable (parseEntry is cached), so these entries persist across viewport changes.
const cache = new WeakMap<MathNode, EvalFunction>();

export function compileNode(node: MathNode): EvalFunction {
  let compiled = cache.get(node);
  if (!compiled) {
    compiled = node.compile();
    cache.set(node, compiled);
  }
  return compiled;
}
