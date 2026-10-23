import { create } from 'zustand';
import type { ScriptError, ScriptFrame } from '../lib/script/protocol';

/**
 * Live (session-only) state of Script mode: the latest validated frame from
 * the sandbox, errors, console output and the script clock. Written by
 * components/Script/ScriptEngine, read by the plot and the script panel. Kept
 * out of the persisted store so 60 fps animation never rewrites storage.
 */
export interface ScriptRuntimeState {
  /** Last good frame (what the plot draws). */
  frame: ScriptFrame | null;
  error: ScriptError | null;
  /** The sandbox killed the last run (timeout / crash): wait for an edit or Run. */
  killed: boolean;
  status: 'idle' | 'starting' | 'ready' | 'running' | 'killed';
  /** Script clock (seconds) and whether it's advancing. */
  time: number;
  playing: boolean;
  /** Last frame's cost in the worker (ms) and round trip. */
  lastMs: number;
  /** Bumped by the Run button: run now, even after a kill. */
  runNonce: number;
  /** Bumped by the Stop button: kill the running script. */
  stopNonce: number;
  /** The script that "Try it" from the docs replaced (offered back once). */
  replaced: string | null;

  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  requestRun: () => void;
  requestStop: () => void;
}

export const useScriptRuntime = create<ScriptRuntimeState>()((set) => ({
  frame: null,
  error: null,
  killed: false,
  status: 'idle',
  time: 0,
  playing: true,
  lastMs: 0,
  runNonce: 0,
  stopNonce: 0,
  replaced: null,
  setTime: (time) => set({ time: Number.isFinite(time) ? Math.max(0, time) : 0 }),
  setPlaying: (playing) => set({ playing }),
  requestRun: () => set((s) => ({ runNonce: s.runNonce + 1, killed: false })),
  requestStop: () => set((s) => ({ stopNonce: s.stopNonce + 1, playing: false })),
}));
