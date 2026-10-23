import type { Entry } from '../../store/types';

/**
 * Pure helpers for the ODE qualitative view: how a coupled group is shown
 * (against t or in the phase plane), state names, and the state edits behind
 * dragging an initial condition / shift-clicking an extra solution. No DOM, so
 * all of it is unit-tested.
 */

/** Half-width of the time window a phase-plane trajectory is integrated over (both ways from t0). */
export const PHASE_SPAN = 30;
/** Steps across the phase window (≈ 0.015 time units per RK4 step). */
export const PHASE_SAMPLES = 4000;
/** Most extra solutions one group keeps (oldest dropped first). */
export const MAX_EXTRA_ICS = 24;
/** Ghost curves drawn per family slider. */
export const FAMILY_N = 7;

/** Internal state symbol ('y', 'D1_y', 'x') → typed name ("y", "y'", "x"). */
export function stateName(symbol: string): string {
  const m = symbol.match(/^D(\d+)_(.+)$/);
  return m ? `${m[2]}${"'".repeat(Number(m[1]))}` : symbol;
}

/** Typed state name ("y'", "y′", "x") → internal symbol ('D1_y', 'x'). */
export function stateSymbol(name: string): string {
  const s = name.trim().replace(/′/g, "'").replace(/″/g, "''");
  const m = s.match(/^([A-Za-z]\w*)('+)$/);
  return m ? `D${m[2].length}_${m[1]}` : s;
}

/** Display label for a state symbol (primes as ′). */
export function stateLabel(symbol: string): string {
  return stateName(symbol).replace(/'/g, '′');
}

/** The group member whose t0 the group uses: the earliest in the list. */
export function groupLeader<T extends { id: string }>(members: T[], entries: { id: string }[]): T {
  let best = members[0];
  let pos = Infinity;
  for (const m of members) {
    const i = entries.findIndex((e) => e.id === m.id);
    if (i >= 0 && i < pos) {
      pos = i;
      best = m;
    }
  }
  return best;
}

export interface GroupView {
  /** Drawn in the phase plane. */
  phase: boolean;
  /** State indices on the horizontal / vertical axis (phase only). */
  axes: [number, number];
  /** Folded into the ODE group cache key. */
  key: string;
}

/**
 * How a group with the given state symbols (in system order) is shown. Phase
 * needs a state of 2+ dimensions; any member's `phase` switches the group, and
 * the first member with valid `phaseAxes` picks the axes (default: the first
 * two components).
 */
export function groupView(members: Entry[], symbols: string[]): GroupView {
  const dim = symbols.length;
  const phase = dim >= 2 && members.some((m) => m.phase);
  if (!phase) return { phase: false, axes: [0, 1], key: '' };
  let axes: [number, number] = [0, 1];
  for (const m of members) {
    if (!m.phaseAxes) continue;
    const a = symbols.indexOf(stateSymbol(m.phaseAxes[0]));
    const b = symbols.indexOf(stateSymbol(m.phaseAxes[1]));
    if (a >= 0 && b >= 0 && a !== b) {
      axes = [a, b];
      break;
    }
  }
  return { phase: true, axes, key: `phase:${axes.join(',')}` };
}

/** The t-window integrated in phase mode. */
export function phaseRange(t0: number): { tMin: number; tMax: number } {
  return { tMin: t0 - PHASE_SPAN, tMax: t0 + PHASE_SPAN };
}

/** Which entry / IC slot holds each component of a group's state vector. */
export interface StateOwner {
  entryId: string;
  /** Index into that entry's `ic` (0 = value, 1 = first derivative, …). */
  k: number;
  /** That entry's ODE order (the length its `ic` resolves to). */
  order: number;
}

/** Pad / trim an IC vector to `order` (value 1, derivatives 0 by default). */
export function resolveIC(ic: number[] | undefined, order: number): number[] {
  const out = new Array<number>(order).fill(0);
  out[0] = 1;
  if (ic) for (let i = 0; i < order; i++) if (i < ic.length && Number.isFinite(ic[i])) out[i] = ic[i];
  return out;
}

/** What dragging an IC dot edits. */
export type IcTarget =
  /** vs t: the dot is (t0, member's value); t0 lives on the group's leader. */
  | { mode: 't'; leaderId: string; owner: StateOwner }
  /** Phase plane: the dot is (state[a], state[b]). */
  | { mode: 'phase'; owners: [StateOwner, StateOwner] };

/**
 * Store patches for dragging an IC dot to (x, y). Patches to the same entry are
 * merged; `entries` supplies the current IC vectors.
 */
export function icDragPatches(
  target: IcTarget,
  x: number,
  y: number,
  entries: Entry[],
): { id: string; patch: Partial<Entry> }[] {
  const out = new Map<string, Partial<Entry>>();
  const icOf = (o: StateOwner): number[] => {
    const prev = out.get(o.entryId)?.ic;
    if (prev) return prev;
    return resolveIC(entries.find((e) => e.id === o.entryId)?.ic, o.order);
  };
  const setIc = (o: StateOwner, v: number) => {
    const ic = icOf(o).slice();
    ic[o.k] = v;
    out.set(o.entryId, { ...out.get(o.entryId), ic });
  };
  if (target.mode === 't') {
    out.set(target.leaderId, { ...out.get(target.leaderId), t0: x });
    setIc(target.owner, y);
  } else {
    setIc(target.owners[0], x);
    setIc(target.owners[1], y);
  }
  return [...out].map(([id, patch]) => ({ id, patch }));
}

/**
 * The extra solution a shift-click at (x, y) adds, as [t0, …state]. vs t (a
 * single equation): starts at t0 = x with value y and the main solution's
 * derivatives; phase plane: the group's t0 and state with the two plotted
 * components replaced.
 */
export function extraFromClick(
  view: { phase: boolean; axes: [number, number] },
  t0: number,
  y0: number[],
  x: number,
  y: number,
): number[] {
  const Y = y0.slice();
  if (view.phase) {
    Y[view.axes[0]] = x;
    Y[view.axes[1]] = y;
    return [t0, ...Y];
  }
  Y[0] = y;
  return [x, ...Y];
}

/**
 * Round a dragged / clicked coordinate to the screen's resolution (a power of
 * ten at or below one pixel), so IC boxes read 0.62 instead of 0.6199998.
 */
export function snapToPixel(v: number, unitsPerPx: number): number {
  if (!(unitsPerPx > 0) || !Number.isFinite(v)) return v;
  const q = Math.pow(10, Math.floor(Math.log10(unitsPerPx)));
  return Number((Math.round(v / q) * q).toPrecision(12));
}

/** Append an extra solution, keeping at most MAX_EXTRA_ICS (oldest dropped). */
export function addExtraIC(list: number[][] | undefined, ic: number[]): number[][] {
  const next = [...(list ?? []), ic];
  return next.length > MAX_EXTRA_ICS ? next.slice(next.length - MAX_EXTRA_ICS) : next;
}

/** What familyApplies needs to know about a row. */
export interface FamilyItem {
  kind: string;
  /** Defined name (derived value / function definition). */
  name?: string;
  deps?: string[];
  /** Functions it calls. */
  calls?: string[];
  /** A derived value (`b = 2a`), not a curve. */
  derived?: boolean;
}

/**
 * Does any curve a family can ghost (an explicit function or an ODE) read the
 * variable `name`, directly or through derived values / user functions?
 * Decides whether a slider shows its family switch.
 */
export function familyApplies(name: string, items: FamilyItem[]): boolean {
  const reads = (it: FamilyItem, set: Set<string>) =>
    !!it.deps?.some((d) => set.has(d)) || !!it.calls?.some((f) => set.has(f));
  // Names whose value changes with `name` (fixpoint over derived values / fndefs).
  const moving = new Set([name]);
  for (let pass = 0; pass < 16; pass++) {
    let grew = false;
    for (const it of items) {
      if (!it.name || moving.has(it.name) || !(it.derived || it.kind === 'fndef')) continue;
      if (reads(it, moving)) {
        moving.add(it.name);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return items.some((it) => (it.kind === 'ode' || (it.kind === 'function' && !it.derived)) && reads(it, moving));
}

/** Evenly spaced family values across [min, max] (both ends included). */
export function familyValues(min: number, max: number, n = FAMILY_N): number[] {
  if (!(max > min)) return [min];
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(min + ((max - min) * k) / (n - 1));
  return out;
}
