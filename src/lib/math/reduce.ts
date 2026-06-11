import type { Parsed } from './parse';
import { compileNode } from './compileCache';
import type { DerivFn } from '../solver/rk4';

export interface OdeBlock {
  depVar: string;
  order: number;
  /** Index in the global state vector where this block's components start. */
  offset: number;
}

export interface OdeSystem {
  dim: number;
  blocks: OdeBlock[];
  /** State-symbol name -> index in the state vector. */
  index: Record<string, number>;
  deriv: DerivFn;
}

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

/**
 * Reduce one or more ODEs (single equation, higher-order, or a coupled system)
 * to a first-order vector system dY/dt = f(t, Y).
 *
 * For an order-n equation y^(n) = g(t, y, ..., y^(n-1)), the state block is
 * [y, y', ..., y^(n-1)] and its derivative is [y', ..., y^(n-1), g]. Blocks for
 * different dependent variables are concatenated; RHS expressions may reference
 * any block's variables (coupling) plus the constant `scope`.
 */
export function buildSystem(
  odes: OdeParsed[],
  scope: Record<string, number>,
): OdeSystem {
  const blocks: OdeBlock[] = [];
  const index: Record<string, number> = {};
  let offset = 0;
  for (const ode of odes) {
    blocks.push({ depVar: ode.depVar, order: ode.order, offset });
    index[ode.depVar] = offset;
    for (let k = 1; k < ode.order; k++) index[`D${k}_${ode.depVar}`] = offset + k;
    offset += ode.order;
  }
  const dim = offset;

  const compiled = odes.map((o) => compileNode(o.node));
  const stateNames = Object.keys(index);
  // One reusable scope object; constants copied in, state symbols overwritten.
  const evalScope: Record<string, number> = { ...scope };

  const deriv: DerivFn = (t, Y) => {
    evalScope.t = t;
    for (let i = 0; i < stateNames.length; i++) {
      const name = stateNames[i];
      evalScope[name] = Y[index[name]];
    }
    const dY = new Array<number>(dim);
    for (let b = 0; b < blocks.length; b++) {
      const { order, offset: off } = blocks[b];
      for (let k = 0; k < order - 1; k++) dY[off + k] = Y[off + k + 1];
      const f = compiled[b].evaluate(evalScope);
      dY[off + order - 1] = typeof f === 'number' ? f : NaN;
    }
    return dY;
  };

  return { dim, blocks, index, deriv };
}

/** Default initial state for an order-n block: value 1, all derivatives 0. */
export function defaultIC(order: number): number[] {
  const ic = new Array<number>(order).fill(0);
  ic[0] = 1;
  return ic;
}
