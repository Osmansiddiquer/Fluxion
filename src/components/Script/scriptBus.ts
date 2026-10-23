import { useStore } from '../../store/useStore';
import { useScriptRuntime } from '../../state/scriptRuntime';
import type { Entry } from '../../store/types';
import { nextColor } from '../../utils/colors';

/**
 * How the Scripting reference talks to the editor without props: snippets are
 * inserted into / replace the open editor (so Ctrl+Z undoes them), or, when no
 * editor is mounted (the reference opened from elsewhere), go straight into the
 * store and switch to Script mode.
 */
export interface EditorHandle {
  replace(code: string): void;
  insert(code: string): void;
  focusLine(line: number): void;
}

let editor: EditorHandle | null = null;

export function registerEditor(h: EditorHandle): () => void {
  editor = h;
  return () => {
    if (editor === h) editor = null;
  };
}

/** Graph-mode expressions a snippet needs (e.g. the ODE it reads). */
export interface SnippetNeeds {
  entries?: { raw: string; ic?: number[] }[];
}

function addMissingEntries(needs?: SnippetNeeds): number {
  if (!needs?.entries?.length) return 0;
  const s = useStore.getState();
  const have = new Set(s.entries.map((e) => e.raw.replace(/\s+/g, '')));
  const add: Entry[] = [];
  for (const n of needs.entries) {
    if (have.has(n.raw.replace(/\s+/g, ''))) continue;
    add.push({
      id: `snip-${Date.now().toString(36)}-${add.length}`,
      raw: n.raw,
      color: nextColor([...s.entries, ...add].map((e) => e.color)),
      visible: true,
      expanded: true,
      ...(n.ic ? { ic: n.ic.slice(), t0: 0 } : {}),
    });
  }
  if (add.length) useStore.setState({ entries: [...s.entries.filter((e) => e.raw.trim()), ...add] });
  return add.length;
}

/** Replace the whole script with a snippet ("Try it"). */
export function trySnippet(code: string, needs?: SnippetNeeds): void {
  addMissingEntries(needs);
  const s = useStore.getState();
  const before = s.script?.code ?? '';
  if (s.mode !== 'script') s.setMode('script');
  if (editor) editor.replace(code);
  else {
    if (before.trim() && before !== code) useScriptRuntime.setState({ replaced: before });
    s.setScriptCode(code);
  }
  useScriptRuntime.getState().setPlaying(true);
}

/** Insert a snippet at the cursor. */
export function insertSnippet(code: string, needs?: SnippetNeeds): void {
  addMissingEntries(needs);
  const s = useStore.getState();
  if (s.mode !== 'script') s.setMode('script');
  if (editor) editor.insert(code);
  else {
    const cur = s.script?.code ?? '';
    s.setScriptCode(cur.trim() ? `${cur.replace(/\n*$/, '')}\n${code}` : code);
  }
}

export function focusLine(line: number): void {
  editor?.focusLine(line);
}

export const hasEditor = () => !!editor;
