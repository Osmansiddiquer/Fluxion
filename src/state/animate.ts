import { parseEntry } from '../lib/math/parse';
import { advance, sliderBounds, valueAt } from '../lib/anim';
import type { Entry } from '../store/types';

/**
 * Advance every playing variable by dt seconds. Pure: returns the new values,
 * updated directions, and the ids that finished (mode "once") or vanished.
 */
export function stepPlaying(
  entries: Entry[],
  playing: Record<string, 1 | -1>,
  dt: number,
): { values: Map<string, number>; dirs: Map<string, 1 | -1>; stopped: string[] } {
  const values = new Map<string, number>();
  const dirs = new Map<string, 1 | -1>();
  const stopped: string[] = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const [id, dir] of Object.entries(playing)) {
    const e = byId.get(id);
    const p = e ? parseEntry(e.raw) : null;
    if (!e || !p || p.kind !== 'variable') {
      stopped.push(id);
      continue;
    }
    const { value, min, max } = sliderBounds(e, p.value);
    const r = advance(value, dir, min, max, e.animMode ?? 'loop', e.animSpeed ?? 1, dt);
    values.set(id, r.value);
    if (r.dir !== dir) dirs.set(id, r.dir);
    if (r.finished) stopped.push(id);
  }
  return { values, dirs, stopped };
}

/** Variable entries flagged `autoplay` that haven't been auto-started yet. */
export function autoplayIds(entries: Entry[], started: Set<string>): string[] {
  return entries
    .filter((e) => e.autoplay && !started.has(e.id) && parseEntry(e.raw).kind === 'variable')
    .map((e) => e.id);
}

/**
 * Deterministic playback: every playing slider at frame `n` of a fixed-`fps`
 * clock, from the value it had when its run started (`starts`). Pure: frame n
 * always gives the same values, however (and however irregularly) the browser
 * delivered the frames before it.
 */
export function valuesAtFrame(
  entries: Entry[],
  ids: Iterable<string>,
  starts: Map<string, number>,
  n: number,
  fps: number,
): { values: Map<string, number>; dirs: Map<string, 1 | -1>; stopped: string[] } {
  const values = new Map<string, number>();
  const dirs = new Map<string, 1 | -1>();
  const stopped: string[] = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of ids) {
    const e = byId.get(id);
    const p = e ? parseEntry(e.raw) : null;
    if (!e || !p || p.kind !== 'variable') {
      stopped.push(id);
      continue;
    }
    const { value, min, max } = sliderBounds(e, p.value);
    const r = valueAt(starts.get(id) ?? value, min, max, e.animMode ?? 'loop', e.animSpeed ?? 1, n / fps);
    values.set(id, r.value);
    dirs.set(id, r.dir);
    if (r.finished) stopped.push(id);
  }
  return { values, dirs, stopped };
}
