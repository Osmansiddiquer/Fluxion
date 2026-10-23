/**
 * Helpers for running scripts headlessly (tests, the CLI checker, example
 * validation). Same runtime as the sandbox worker, no isolation — only for
 * code we trust or under node:vm with a timeout (cli/scriptCheck.ts).
 */
import { compileScript, runScript, type RunResult } from './runtime';
import { createGraphBridge } from './graphBridge';
import { sanitizeFrame, type ClipMeta, type GraphEntryData, type ScriptInputs } from './protocol';

export const DEFAULT_INPUTS: ScriptInputs = {
  time: 0,
  sliders: {},
  view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 },
  theme: 'light',
};

export interface HeadlessOpts {
  time?: number;
  sliders?: Record<string, number>;
  view?: ScriptInputs['view'];
  theme?: ScriptInputs['theme'];
  entries?: GraphEntryData[];
  clips?: ClipMeta[];
}

/** Compile + run once; a compile error comes back as `error` with an empty frame. */
export function runHeadless(code: string, o: HeadlessOpts = {}): RunResult {
  const c = compileScript(code);
  if (!c.ok) {
    return {
      error: c.error,
      frame: { items: [], background: null, sliders: [], logs: [], loop: null, ms: 0, animated: false },
    };
  }
  const r = runScript(c.script, {
    inputs: {
      ...DEFAULT_INPUTS,
      time: o.time ?? 0,
      sliders: o.sliders ?? {},
      view: o.view ?? DEFAULT_INPUTS.view,
      theme: o.theme ?? 'light',
    },
    graph: createGraphBridge(o.entries ?? []),
    clips: o.clips ?? [],
  });
  // What the app would accept.
  const s = sanitizeFrame(r.frame);
  if (!s.ok) return { frame: r.frame, error: r.error ?? { message: s.error } };
  return r.error ? { frame: s.frame, error: r.error } : { frame: s.frame };
}
